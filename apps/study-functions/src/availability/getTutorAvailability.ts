import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldPath } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { parisWallClockPosition } from '@ejm/shared-functions/scheduled/parisTime.js';
import { getParentProfile, timeToSlotIndex } from '@ejm/shared-core';
import type { User, DayOfWeek } from '@ejm/shared-core';
import type { StudyUser, TutorProfile, LocationPref } from '@ejm/study-core';
import {
  computeDayAvailability,
  getSchoolYearsInRange,
  incrementDate,
  dayOfWeek,
  type ConfirmedBlock,
  type DayOverride,
} from '@ejm/study-core';
import { getTutorAvailabilitySchema } from '../validation/availability.js';

/** Notice window: families cannot book within this many hours of "now". */
const NOTICE_HOURS = 24;

/**
 * Every "YYYY-MM-DD" date from startDate to endDate inclusive. Composes
 * study-core's pure incrementDate — no epoch-ms stepping, DST-safe.
 */
function eachDateInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = incrementDate(cursor);
  }
  return dates;
}

type WeeklyGrid = Partial<Record<DayOfWeek, boolean[]>>;

/**
 * getTutorAvailability — returns a tutor's bookable slot grid per date to an
 * approved family. Reads only; writes nothing but an audit entry. The output is
 * boolean grids ONLY: no session details, no reasons — availability is
 * consent-gated exactly like the tutor's contact fields.
 */
export const getTutorAvailability = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = getTutorAvailabilitySchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { tutorUserId, startDate, endDate } = parsed.data;

    // ── Caller gate: parent with a fully-verified family ──
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerParent = getParentProfile(callerDoc.data() as User | undefined);
    if (!callerParent || !callerParent.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can view tutor availability');
    }
    const callerFamilyId = callerParent.familyId; // server-derived; never from input
    const familyDoc = await db.collection('families').doc(callerFamilyId).get();
    if (!familyDoc.data()?.verification?.isFullyVerified) {
      throw new HttpsError('permission-denied', 'Family verification required before viewing availability');
    }

    // ── Tutor must exist, be active, and have completed enrollment ──
    const tutorDoc = await db.collection('users').doc(tutorUserId).get();
    const tutorUser = tutorDoc.data() as StudyUser | undefined;
    if (!tutorDoc.exists || tutorUser?.status !== 'active') {
      throw new HttpsError('not-found', 'Tutor not found or not active');
    }
    const tutor: TutorProfile | undefined = tutorUser.profiles?.tutor;
    if (!tutor?.enrollmentComplete) {
      throw new HttpsError('failed-precondition', 'Tutor has not completed enrollment');
    }

    // ── Consent gate: availability is only visible to approved families ──
    if (!(tutor.approvedFamilies ?? []).includes(callerFamilyId)) {
      throw new HttpsError('permission-denied', 'Availability requires an accepted contact request');
    }

    // ── Load the tutor's weekly grid (absent schedule doc → all-false) ──
    const scheduleSnap = await db.collection('schedules').doc(tutorUserId).get();
    const schedule = scheduleSnap.data();
    const weekly: WeeklyGrid = (schedule?.weekly as WeeklyGrid) ?? {};
    const holidayMode = schedule?.holidayMode as string | undefined;
    const holidaySchedules =
      (schedule?.holidaySchedules as Record<string, WeeklyGrid> | undefined) ??
      undefined;
    const paddingMin = tutor.paddingMin ?? 0;

    // ── Per-date overrides in range (doc ID is the date) ──
    const overridesSnap = await db
      .collection('schedules')
      .doc(tutorUserId)
      .collection('overrides')
      .where(FieldPath.documentId(), '>=', startDate)
      .where(FieldPath.documentId(), '<=', endDate)
      .get();
    const overrideByDate = new Map<string, DayOverride>();
    for (const doc of overridesSnap.docs) {
      const data = doc.data();
      overrideByDate.set(doc.id, {
        type: data.type as DayOverride['type'],
        slots: data.slots as boolean[] | undefined,
      });
    }

    // ── Holiday-period grid substitution (only when holidayMode is 'different') ──
    let holidayPeriods: { name: string; startDate: string; endDate: string }[] = [];
    if (holidayMode === 'different') {
      const years = getSchoolYearsInRange(startDate, endDate);
      const holidaySnaps = await Promise.all(
        years.map((y) => db.collection('holidays').doc(y).get()),
      );
      for (const snap of holidaySnaps) {
        const periods = snap.data()?.periods as
          | { name: string; startDate: string; endDate: string }[]
          | undefined;
        if (periods) holidayPeriods.push(...periods);
      }
    }
    const holidayGridFor = (date: string, dow: DayOfWeek): boolean[] | undefined => {
      if (holidayMode !== 'different') return undefined;
      const period = holidayPeriods.find(
        (p) => date >= p.startDate && date <= p.endDate,
      );
      if (!period) return undefined;
      return holidaySchedules?.[period.name]?.[dow];
    };

    // ── Confirmed sessions in range → per-date blocks (defense-in-depth) ──
    // Needs the (tutorUserId, status, date) composite index (added in this PR).
    const sessionsSnap = await db
      .collection('study-sessions')
      .where('tutorUserId', '==', tutorUserId)
      .where('status', '==', 'confirmed')
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .get();
    const blocksByDate = new Map<string, ConfirmedBlock[]>();
    for (const doc of sessionsSnap.docs) {
      const s = doc.data();
      const date = s.date as string | undefined;
      if (!date) continue; // recurring sessions carry no single date — skipped here
      const block: ConfirmedBlock = {
        startIdx: timeToSlotIndex(s.startTime as string),
        endIdx: timeToSlotIndex(s.endTime as string),
        location: s.location as LocationPref,
      };
      const list = blocksByDate.get(date) ?? [];
      list.push(block);
      blocksByDate.set(date, list);
    }

    // ── Compute each date's grid ──
    const nowParis = parisWallClockPosition(new Date());
    const dates = eachDateInRange(startDate, endDate).map((date) => {
      const dow = dayOfWeek(date);
      const slots = computeDayAvailability({
        date,
        weeklySlots: weekly[dow] ?? [],
        override: overrideByDate.get(date),
        holidayGrid: holidayGridFor(date, dow),
        confirmedBlocks: blocksByDate.get(date) ?? [],
        paddingMin,
        nowParis,
        noticeHours: NOTICE_HOURS,
      });
      return { date, slots };
    });

    await writeUserActivity(uid, 'availability_viewed', { tutorUserId });

    return { dates };
  },
);
