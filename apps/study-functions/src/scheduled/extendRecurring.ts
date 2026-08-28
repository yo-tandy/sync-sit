import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getConfigValue } from '@ejm/shared-functions/config/adminConfig.js';
import type { Firestore } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import {
  parisDateString,
  parisWallClockPosition,
} from '@ejm/shared-functions/scheduled/parisTime.js';
import type { RecurringSlot } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import {
  getSchoolYearsInRange,
  expandRecurringDates,
  incrementDate,
  type DayOverride,
  type ConfirmedBlock,
} from '@ejm/study-core';
import {
  sessionToConfirmedBlock,
  type WeeklyGrid,
  type HolidayPeriod,
} from '../availability/computeDateAvailability.js';
import { generateInstances, type PerDateClaimInputs } from '../sessions/generateInstances.js';
import { dropWithinNotice } from '../sessions/recurringWindow.js';

export interface ExtendRecurringStats {
  seriesProcessed: number;
  instancesScheduled: number;
  instancesSkipped: number;
  errors: number;
}

/**
 * Extend every confirmed recurring series so it always has the configured
 * recurringHorizonWeeks (issue #250; default 8 weeks) of instances ahead.
 * As time passes the front occurrences fall into the past and this cron
 * materializes new ones at the back — a rolling window.
 *
 * IDEMPOTENT and SELF-HEALING: each run regenerates the FULL horizon and
 * creates instances create-if-absent (date-keyed IDs), so a re-run creates
 * nothing, and a missed run is caught up by the next. Every series runs in its
 * OWN transaction wrapped in try/catch — a single poisoned doc can never block
 * the rest of the run.
 *
 * Extracted for testability (injectable db + now); the cron wrapper below calls
 * it with the real db and clock.
 */
export async function runExtendRecurring(
  firestoreDb: Firestore,
  now: Date,
): Promise<ExtendRecurringStats> {
  // Equality-only query — served without a composite index.
  const seriesSnap = await firestoreDb
    .collection('study-sessions')
    .where('type', '==', 'recurring')
    .where('status', '==', 'confirmed')
    .get();

  const stats: ExtendRecurringStats = {
    seriesProcessed: 0,
    instancesScheduled: 0,
    instancesSkipped: 0,
    errors: 0,
  };

  for (const doc of seriesSnap.docs) {
    try {
      const skipped = await extendOne(firestoreDb, doc.ref, doc.data(), now);
      stats.seriesProcessed += 1;
      stats.instancesScheduled += skipped.scheduledDates.length;
      stats.instancesSkipped += skipped.skippedDates.length;
    } catch (err) {
      // Isolation: a corrupt/poisoned series must not abort the whole run.
      console.error(`extendRecurring: series ${doc.id} failed`, err);
      stats.errors += 1;
    }
  }

  return stats;
}

/**
 * Extend one confirmed series by one transaction. Returns the dates newly
 * scheduled / conflict-skipped THIS run (both empty when nothing was missing).
 */
async function extendOne(
  firestoreDb: Firestore,
  sessionRef: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  now: Date,
): Promise<{ scheduledDates: string[]; skippedDates: string[] }> {
  const slot = (data.recurringSlots as RecurringSlot[])[0]; // throws if corrupt → caught by caller
  const tutorUserId = data.tutorUserId as string;
  const familyId = data.familyId as string;
  const schoolWeeksOnly = data.schoolWeeksOnly !== false; // default true
  const endDate = data.endDate as string | undefined;

  // ── Candidate dates over the rolling horizon, anchored at TODAY (Paris) ──
  // Full-horizon regeneration is what makes the cron self-healing; create-if-
  // absent (below) makes it idempotent. endDate handling: expandRecurringDates
  // never emits a date past endDate, so a series whose endDate has passed yields
  // zero candidates and this run is a no-op. COMPLETION (flip parent → completed
  // once endDate has passed and no scheduled instances remain) is DEFERRED to
  // PR 4's completion cron — keeping this cron purely additive.
  const fromDate = parisDateString(now);
  let horizonEnd = fromDate;
  const horizonWeeks = await getConfigValue('recurringHorizonWeeks');
  // The recurring notice window follows the same configured value the
  // booking/confirm paths use (issue #250 review round 1 -- this site was
  // the one enforcing the hardcoded 24h while its siblings were config-fed).
  const noticeHours = await getConfigValue('bookingNoticeHours');
  for (let i = 0; i < horizonWeeks * 7; i++) horizonEnd = incrementDate(horizonEnd);
  const rangeEnd = endDate !== undefined && endDate < horizonEnd ? endDate : horizonEnd;

  // Static availability config (per-tutor) + school-holiday periods across range.
  const scheduleRef = firestoreDb.collection('schedules').doc(tutorUserId);
  const scheduleSnap = await scheduleRef.get();
  const scheduleData = scheduleSnap.data();
  const weekly: WeeklyGrid = (scheduleData?.weekly as WeeklyGrid) ?? {};
  const holidayMode = scheduleData?.holidayMode as string | undefined;
  const holidaySchedules = scheduleData?.holidaySchedules as
    | Record<string, WeeklyGrid>
    | undefined;
  const holidayPeriods: HolidayPeriod[] = [];
  if (rangeEnd >= fromDate) {
    const years = getSchoolYearsInRange(fromDate, rangeEnd);
    const snaps = await Promise.all(
      years.map((y) => firestoreDb.collection('holidays').doc(y).get()),
    );
    for (const snap of snaps) {
      const p = snap.data()?.periods as HolidayPeriod[] | undefined;
      if (p) holidayPeriods.push(...p);
    }
  }

  const candidates = dropWithinNotice(
    expandRecurringDates(slot, fromDate, horizonWeeks, endDate, schoolWeeksOnly, holidayPeriods),
    slot.startTime,
    now,
    noticeHours,
  );
  if (candidates.length === 0) {
    return { scheduledDates: [], skippedDates: [] };
  }

  const outcome = await firestoreDb.runTransaction(async (tx) => {
    // Re-read the parent authoritatively — it may have been cancelled between the
    // query and this transaction.
    const parentSnap = await tx.get(sessionRef);
    const parent = parentSnap.data();
    if (!parent || parent.status !== 'confirmed' || parent.type !== 'recurring') {
      return { scheduledDates: [], skippedDates: [] };
    }

    // ── Create-if-absent: only dates that DON'T already have an instance ──
    // (Any status counts — a prior conflict_skip is a real, sticky decision.)
    const instanceRefs = candidates.map((d) => sessionRef.collection('instances').doc(d));
    const instanceSnaps = await Promise.all(instanceRefs.map((r) => tx.get(r)));
    const absent = candidates.filter((_, i) => !instanceSnaps[i].exists);
    if (absent.length === 0) {
      return { scheduledDates: [], skippedDates: [] };
    }

    // ── All remaining claim reads BEFORE writes ──
    const minDate = absent[0];
    const maxDate = absent[absent.length - 1];
    const cgQuery = firestoreDb
      .collectionGroup('instances')
      .where('tutorUserId', '==', tutorUserId)
      .where('status', '==', 'scheduled')
      .where('date', '>=', minDate)
      .where('date', '<=', maxDate);
    const overrideRefs = absent.map((d) => scheduleRef.collection('overrides').doc(d));
    const confirmedQueries = absent.map((d) =>
      firestoreDb
        .collection('study-sessions')
        .where('tutorUserId', '==', tutorUserId)
        .where('status', '==', 'confirmed')
        .where('date', '==', d),
    );
    const cgSnap = await tx.get(cgQuery);
    const overrideSnaps = await Promise.all(overrideRefs.map((r) => tx.get(r)));
    const confirmedSnaps = await Promise.all(confirmedQueries.map((q) => tx.get(q)));

    const cgByDate = new Map<string, ConfirmedBlock[]>();
    for (const d of cgSnap.docs) {
      const s = d.data();
      if (s.sessionId === sessionRef.id) continue; // never self-block on our own instances
      const date = s.date as string;
      const arr = cgByDate.get(date) ?? [];
      arr.push(
        sessionToConfirmedBlock({
          startTime: s.startTime as string,
          endTime: s.endTime as string,
          location: s.location as LocationPref,
        }),
      );
      cgByDate.set(date, arr);
    }

    const perDate = new Map<string, PerDateClaimInputs>();
    for (let i = 0; i < absent.length; i++) {
      const date = absent[i];
      const oSnap = overrideSnaps[i];
      const existing = oSnap.exists ? oSnap.data()! : null;
      const override: DayOverride | null = existing
        ? {
            type: existing.type as DayOverride['type'],
            slots: existing.slots as boolean[] | undefined,
          }
        : null;
      const confirmedBlocks = confirmedSnaps[i].docs.map((cd) => {
        const s = cd.data();
        return sessionToConfirmedBlock({
          startTime: s.startTime as string,
          endTime: s.endTime as string,
          location: s.location as LocationPref,
        });
      });
      perDate.set(date, {
        override,
        existingOverride: existing,
        confirmedBlocks,
        cgInstanceBlocks: cgByDate.get(date) ?? [],
      });
    }

    return generateInstances({
      tx,
      sessionRef,
      scheduleRef,
      parent: {
        sessionId: sessionRef.id,
        familyId,
        tutorUserId,
        subject: parent.subject as string,
        level: parent.level as string,
        rate: parent.rate as number,
        location: parent.location as LocationPref,
        sessionLengthMinutes: parent.sessionLengthMinutes as number,
        paddingMinutes: (parent.paddingMinutes as number) ?? 0,
        startTime: slot.startTime,
        endTime: slot.endTime,
      },
      candidateDates: absent,
      perDate,
      config: { weekly, holidayMode, holidaySchedules, holidayPeriods },
      nowParis: parisWallClockPosition(now),
      now,
    });
  });

  // ── Notifications: SILENT for new scheduled dates and holiday drops. Notify
  // the family (cancelled prefs) ONLY for NEW conflict_skip dates — every date
  // in skippedDates is new this run (absent → freshly cancelled). ──
  if (outcome.skippedDates.length > 0) {
    const dates = outcome.skippedDates.join(', ');
    await notifyAllParents({
      familyId,
      prefCategory: 'cancelled',
      app: 'study',
      type: 'study_session_cancelled',
      title: 'A recurring session could not be scheduled',
      body: `Some upcoming sessions could not be scheduled (${dates}).`,
      emailSubject: 'Upcoming recurring session unavailable',
      emailBody: `
        <p>One or more upcoming sessions in your recurring series could not be scheduled because the time is no longer available: <strong>${dates}</strong>.</p>
        <p>Your other sessions are unaffected.</p>
        <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
      `,
      data: { sessionId: sessionRef.id },
    });
  }

  return outcome;
}

export const extendRecurring = onSchedule(
  {
    // Weekly, Monday 04:00 Europe/Paris — a quiet hour, well before the day's
    // booking traffic. At the default 8-week horizon a weekly cadence keeps ~7 weeks
    // of slack even if a run is missed.
    schedule: '0 4 * * 1',
    region: 'europe-west1',
    timeZone: 'Europe/Paris',
  },
  async () => {
    const stats = await runExtendRecurring(db, new Date());
    console.log(
      `extendRecurring: ${stats.seriesProcessed} series, ${stats.instancesScheduled} scheduled, ${stats.instancesSkipped} skipped, ${stats.errors} errors`,
    );
  },
);
