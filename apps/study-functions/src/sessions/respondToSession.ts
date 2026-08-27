import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getConfigValue } from '@ejm/shared-functions/config/adminConfig.js';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { escapeHtml, sendNotificationEmail, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import {
  isActiveGuardianOf,
  notifyChildOfGuardianAction,
} from '@ejm/shared-functions/guardian/guardianAccess.js';
import {
  parisWallClockPosition,
  parisWallTimeToUtc,
  parisDateString,
} from '@ejm/shared-functions/scheduled/parisTime.js';
import { timeToSlotIndex, getParentProfile } from '@ejm/shared-core';
import type { RecurringSlot, User } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import {
  getSchoolYearsInRange,
  expandRecurringDates,
  incrementDate,
  dayOfWeek,
  type DayOverride,
  type ConfirmedBlock,
} from '@ejm/study-core';
import { respondToSessionSchema } from '../validation/session.js';
import {
  computeDateAvailability,
  sessionToConfirmedBlock,
  type WeeklyGrid,
  type HolidayPeriod,
} from '../availability/computeDateAvailability.js';
import { paddedBlock, overlaps, buildMergedOverride } from './sessionOverride.js';
import { generateInstances, type PerDateClaimInputs } from './generateInstances.js';
import { dropWithinNotice } from './recurringWindow.js';

/** How many weeks of occurrences a recurring confirm materializes up front. */
const RECURRING_HORIZON_WEEKS = 8;

/** Notice window: a session cannot be confirmed within this many hours of "now". */
const NOTICE_HOURS = 24;

/**
 * respondToSession — the tutor confirms or declines a pending session request.
 *
 * CONFIRM is the claim point (the core invariant: "pending is a proposal,
 * confirm is the claim"). It runs in a single transaction — all reads first —
 * that re-checks availability against the CURRENT override + confirmed sessions
 * and, if the padded block is still free, flips the session to `confirmed` and
 * writes a RESTORABLE override ledger: the day's slots with our block AND-ed to
 * false, plus a `sessionBlocks` entry recording exactly what we claimed. The
 * merge preserves any pre-existing override doc's fields and never resurrects a
 * slot it did not itself block (contrast sit's lossy whole-day override).
 */
export const respondToSession = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = respondToSessionSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { sessionId, action, studentIds } = parsed.data;

    const now = new Date();
    const sessionRef = db.collection('study-sessions').doc(sessionId);

    // ── Peek the session FIRST (THE hot-path re-sequencing) ──
    // The pre-tx schedule/holiday config load below must key on the session's
    // TUTOR, not the caller — for a tutor PROPOSAL the caller is the family, not
    // the tutor whose schedule is claimed. So we resolve tutorUserId (and the
    // role/consent gate) from a peek here; the transaction still re-reads the
    // session authoritatively. For a family-initiated session caller === tutor,
    // so this peek changes nothing (the existing respond suites stay green).
    const peekSnap = await sessionRef.get();
    if (!peekSnap.exists) {
      throw new HttpsError('not-found', 'Session not found');
    }
    const peekSession = peekSnap.data()!;
    const sessionTutorUserId = peekSession.tutorUserId as string;
    const proposedBy = (peekSession.proposedBy as string | undefined) ?? 'family';
    const respondedByFamily = proposedBy === 'provider';

    // ── Role/consent gate (exclusive-by-proposedBy) ──
    // provider proposal → the FAMILY responds; the proposer (the tutor) can NEVER
    // respond to their own proposal (self-confirming would fabricate family
    // consent — the consent hole this guard closes). Otherwise (family-initiated
    // or legacy no-proposedBy) → the TUTOR responds, or a GUARDIAN of the tutor
    // — but DECLINE-ONLY: a guardian protects, they never consent on the kid's
    // behalf, so a confirm attempt via the guardian path is refused outright.
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerUser = callerDoc.data() as User | undefined;
    const callerFamilyId = getParentProfile(callerUser)?.familyId;
    let guardianActor = false;
    if (respondedByFamily) {
      if (sessionTutorUserId === uid) {
        throw new HttpsError('permission-denied', 'You cannot respond to your own proposal');
      }
      if (!callerFamilyId || callerFamilyId !== peekSession.familyId) {
        throw new HttpsError('permission-denied', 'You are not part of this session');
      }
    } else if (sessionTutorUserId !== uid) {
      if (await isActiveGuardianOf(uid, sessionTutorUserId)) {
        if (action !== 'decline') {
          throw new HttpsError(
            'permission-denied',
            'A guardian can decline on behalf of the kid, never accept.',
            { code: 'guardian/decline-only' },
          );
        }
        guardianActor = true;
      } else {
        throw new HttpsError('permission-denied', 'You are not the tutor for this session');
      }
    }

    // ── Provider-proposal confirm: the family picks students at accept ──
    // studentIds is REQUIRED here (a proposal carries an empty roster); validate
    // kid ownership + denormalize the roster and the accepting parent's name.
    // These are NON-CONTENDED reads (a family's own kids + the caller's own name),
    // so they belong OUTSIDE the claim transaction. Written into the doc at confirm.
    let providerConfirmDenorm:
      | { studentIds: string[]; students: { firstName: string; age: number }[]; parentName: string }
      | null = null;
    if (action === 'confirm' && respondedByFamily) {
      if (!studentIds || studentIds.length === 0) {
        throw new HttpsError('invalid-argument', 'Select at least one student to confirm');
      }
      const kidSnaps = await Promise.all(
        studentIds.map((id) =>
          db
            .collection('families')
            .doc(peekSession.familyId as string)
            .collection('kids')
            .doc(id)
            .get(),
        ),
      );
      const students: { firstName: string; age: number }[] = [];
      for (const snap of kidSnaps) {
        if (!snap.exists) {
          throw new HttpsError('not-found', 'One or more selected students were not found');
        }
        const kid = snap.data()!;
        students.push({ firstName: (kid.firstName as string) ?? '', age: (kid.age as number) ?? 0 });
      }
      const parentName = `${callerUser?.firstName || ''} ${callerUser?.lastName || ''}`.trim();
      providerConfirmDenorm = { studentIds, students, parentName };
    }

    // ── Pre-load static availability config OUTSIDE the transaction (confirm) ──
    // The tutor's weekly grid and holiday schedule/periods are static per-tutor
    // config, NOT the contended claim state two racing confirms fight over — that
    // is the override doc + the confirmed sessions, which ARE read via tx.get
    // below. So this config needs no tx.get: a stale weekly/holiday read cannot
    // cause a double-book (the override/confirmed reads that gate the claim are
    // transactional). We peek the session here only to resolve its date for the
    // holiday-period lookup; the transaction re-reads it authoritatively.
    let config: {
      weekly: WeeklyGrid;
      holidayMode?: string;
      holidaySchedules?: Record<string, WeeklyGrid>;
      holidayPeriods: HolidayPeriod[];
    } | null = null;
    // For a recurring confirm: the slot + the candidate dates RECOMPUTED at
    // confirm time (never trusted from book time), anchored exactly as booking
    // did (first occurrence ≥ now+24h Paris).
    let recurringPlan: { slot: RecurringSlot; candidates: string[] } | null = null;
    if (action === 'confirm') {
      // Re-keyed to session.tutorUserId (not the caller): the claim is always on
      // the tutor's schedule, whoever is confirming.
      const scheduleSnap = await db.collection('schedules').doc(sessionTutorUserId).get();
      const scheduleData = scheduleSnap.data();
      const weekly: WeeklyGrid = (scheduleData?.weekly as WeeklyGrid) ?? {};
      const holidayMode = scheduleData?.holidayMode as string | undefined;
      const holidaySchedules = scheduleData?.holidaySchedules as
        | Record<string, WeeklyGrid>
        | undefined;
      const peek = peekSession;
      const holidayPeriods: HolidayPeriod[] = [];

      if (peek?.type === 'recurring') {
        const slot = (peek.recurringSlots as RecurringSlot[] | undefined)?.[0];
        const schoolWeeksOnly = peek.schoolWeeksOnly !== false; // default true
        const endDate = peek.endDate as string | undefined;

        // Anchor the horizon at now+24h Paris — SHARED SEAM with bookSession's
        // first-occurrence notice logic. (A Task-1 review finding about
        // hour-granularity on this date-anchored window, if it lands, fixes both.)
        const fromDate = parisDateString(
          new Date(now.getTime() + (await getConfigValue('bookingNoticeHours').catch(() => NOTICE_HOURS)) * 60 * 60 * 1000),
        );
        let horizonEnd = fromDate;
        for (let i = 0; i < (await getConfigValue('recurringHorizonWeeks').catch(() => RECURRING_HORIZON_WEEKS)) * 7; i++) horizonEnd = incrementDate(horizonEnd);
        const rangeEnd = endDate !== undefined && endDate < horizonEnd ? endDate : horizonEnd;

        // School-holiday periods across the window — drives schoolWeeksOnly AND
        // (when holidayMode==='different') the per-date grid substitution.
        if (rangeEnd >= fromDate) {
          const years = getSchoolYearsInRange(fromDate, rangeEnd);
          const holidaySnaps = await Promise.all(
            years.map((y) => db.collection('holidays').doc(y).get()),
          );
          for (const snap of holidaySnaps) {
            const p = snap.data()?.periods as HolidayPeriod[] | undefined;
            if (p) holidayPeriods.push(...p);
          }
        }

        if (slot) {
          const rawCandidates = expandRecurringDates(
            slot,
            fromDate,
            (await getConfigValue('recurringHorizonWeeks').catch(() => RECURRING_HORIZON_WEEKS)),
            endDate,
            schoolWeeksOnly,
            holidayPeriods,
          );
          // Drop occurrences inside the precise 24h notice window ENTIRELY (no
          // instance), so the date-granular anchor never yields a spurious
          // conflict_skip for the first occurrence — it simply rolls to next week.
          const candidates = dropWithinNotice(rawCandidates, slot.startTime, now, (await getConfigValue('bookingNoticeHours').catch(() => NOTICE_HOURS)));
          recurringPlan = { slot, candidates };
        }
      } else {
        const peekDate = peek?.date as string | undefined;
        if (holidayMode === 'different' && peekDate) {
          const years = getSchoolYearsInRange(peekDate, peekDate);
          const holidaySnaps = await Promise.all(
            years.map((y) => db.collection('holidays').doc(y).get()),
          );
          for (const snap of holidaySnaps) {
            const p = snap.data()?.periods as HolidayPeriod[] | undefined;
            if (p) holidayPeriods.push(...p);
          }
        }
      }
      config = { weekly, holidayMode, holidaySchedules, holidayPeriods };
    }

    // ── The claim transaction: all reads before any writes ──
    const outcome = await db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists) {
        throw new HttpsError('not-found', 'Session not found');
      }
      const session = sessionSnap.data()!;
      // Role was gated pre-tx (peek); re-derive the tutor whose schedule is
      // claimed. The claim is ALWAYS on session.tutorUserId — for a provider
      // proposal the confirming caller is the family, not this tutor.
      const tutorUserId = session.tutorUserId as string;
      if (session.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'This session is no longer pending');
      }

      const familyId = session.familyId as string;
      const location = session.location as LocationPref;
      const paddingMinutes = (session.paddingMinutes as number) ?? 0;

      // ── Decline: flip status, no override/instances, no schedule mutation ──
      // A family declining a provider proposal reads 'declined_by_family'; a tutor
      // declining a family request reads 'declined_by_tutor'.
      if (action === 'decline') {
        tx.update(sessionRef, {
          status: 'declined',
          statusReason: respondedByFamily ? 'declined_by_family' : 'declined_by_tutor',
          updatedAt: now,
        });
        return {
          action: 'decline' as const,
          type: session.type as string,
          familyId,
          tutorUserId,
          respondedByFamily,
        };
      }

      const cfg = config!; // set whenever action === 'confirm'
      const scheduleRef = db.collection('schedules').doc(tutorUserId);

      // ── Recurring confirm: materialize the 8-week instance window ──
      // Instances become the dated, availability-participating docs (the parent
      // has no top-level `date`). Zero bookable dates → failed-precondition and
      // the parent stays pending (the throw rolls back every instance/override).
      if (session.type === 'recurring') {
        const plan = recurringPlan;
        if (!plan || plan.candidates.length === 0) {
          throw new HttpsError('failed-precondition', 'No bookable dates for this recurring series');
        }
        const candidates = plan.candidates;
        const minDate = candidates[0];
        const maxDate = candidates[candidates.length - 1];

        // ── ALL claim-participating reads BEFORE any write (tx reads-first rule) ──
        // Other recurring series' `scheduled` instances in range via a
        // collection-group query — the Admin SDK runs CG queries inside a
        // transaction, so this is the authoritative cross-series claim read. The
        // (tutorUserId, status, date) COLLECTION_GROUP index lands in Task 4.
        const cgQuery = db
          .collectionGroup('instances')
          .where('tutorUserId', '==', tutorUserId)
          .where('status', '==', 'scheduled')
          .where('date', '>=', minDate)
          .where('date', '<=', maxDate);
        const overrideRefs = candidates.map((d) => scheduleRef.collection('overrides').doc(d));
        const confirmedQueries = candidates.map((d) =>
          db
            .collection('study-sessions')
            .where('tutorUserId', '==', tutorUserId)
            .where('status', '==', 'confirmed')
            .where('date', '==', d),
        );

        const cgSnap = await tx.get(cgQuery);
        const overrideSnaps = await Promise.all(overrideRefs.map((r) => tx.get(r)));
        const confirmedSnaps = await Promise.all(confirmedQueries.map((q) => tx.get(q)));

        // Group OTHER series' scheduled instances by date (skip our own, if any —
        // idempotency guard, though a pending series has none yet).
        const cgByDate = new Map<string, ConfirmedBlock[]>();
        for (const doc of cgSnap.docs) {
          const s = doc.data();
          if (s.sessionId === sessionId) continue;
          const d = s.date as string;
          const arr = cgByDate.get(d) ?? [];
          arr.push(
            sessionToConfirmedBlock({
              startTime: s.startTime as string,
              endTime: s.endTime as string,
              location: s.location as LocationPref,
            }),
          );
          cgByDate.set(d, arr);
        }

        const perDate = new Map<string, PerDateClaimInputs>();
        for (let i = 0; i < candidates.length; i++) {
          const d = candidates[i];
          const oSnap = overrideSnaps[i];
          const existing = oSnap.exists ? oSnap.data()! : null;
          const override: DayOverride | null = existing
            ? {
                type: existing.type as DayOverride['type'],
                slots: existing.slots as boolean[] | undefined,
              }
            : null;
          const confirmedBlocks = confirmedSnaps[i].docs.map((doc) => {
            const s = doc.data();
            return sessionToConfirmedBlock({
              startTime: s.startTime as string,
              endTime: s.endTime as string,
              location: s.location as LocationPref,
            });
          });
          perDate.set(d, {
            override,
            existingOverride: existing,
            confirmedBlocks,
            cgInstanceBlocks: cgByDate.get(d) ?? [],
          });
        }

        const slot = plan.slot;
        const { scheduledDates, skippedDates } = generateInstances({
          tx,
          sessionRef,
          scheduleRef,
          parent: {
            sessionId,
            familyId,
            tutorUserId,
            subject: session.subject as string,
            level: session.level as string,
            rate: session.rate as number,
            location,
            sessionLengthMinutes: session.sessionLengthMinutes as number,
            paddingMinutes,
            startTime: slot.startTime,
            endTime: slot.endTime,
          },
          candidateDates: candidates,
          perDate,
          config: {
            weekly: cfg.weekly,
            holidayMode: cfg.holidayMode,
            holidaySchedules: cfg.holidaySchedules,
            holidayPeriods: cfg.holidayPeriods,
          },
          nowParis: parisWallClockPosition(now),
          now,
          // Trial-first-session (V1.1 feature 2): mark the first scheduled
          // instance as the trial when the family opted in at book time. This is
          // the ONLY generateInstances caller that sets this — the extendRecurring
          // cron never does (see generateInstances' markFirstScheduledAsTrial doc).
          markFirstScheduledAsTrial: session.trialFirstSession === true,
        });

        if (scheduledDates.length === 0) {
          throw new HttpsError('failed-precondition', 'No bookable dates for this recurring series');
        }

        tx.update(sessionRef, { status: 'confirmed', confirmedAt: now, updatedAt: now });
        // The overlap block auto-decline uses against one_time pendings — the
        // weekly slot claims the same [start,end) on every scheduled date.
        const block = paddedBlock(slot.startTime, slot.endTime, location, paddingMinutes);
        return {
          action: 'confirm' as const,
          type: 'recurring' as const,
          familyId,
          tutorUserId,
          respondedByFamily,
          block,
          scheduledDates,
          skippedDates,
        };
      }

      // ── one_time confirm: re-check notice, recompute availability, claim ──
      const date = session.date as string;
      const startTime = session.startTime as string;
      const endTime = session.endTime as string;

      // Re-check the 24h notice — a pending request can go stale.
      const sessionStart = parisWallTimeToUtc(date, startTime);
      if (sessionStart.getTime() < now.getTime() + (await getConfigValue('bookingNoticeHours').catch(() => NOTICE_HOURS)) * 60 * 60 * 1000) {
        throw new HttpsError(
          'failed-precondition',
          'This request is too close to the session time',
        );
      }

      // Claim-participating reads (transactional): ONLY the contended state —
      // the current override doc and the other confirmed sessions on this date.
      // Weekly grid + holiday config came from the pre-tx `config` load above.
      const overrideRef = scheduleRef.collection('overrides').doc(date);
      const confirmedQuery = db
        .collection('study-sessions')
        .where('tutorUserId', '==', tutorUserId)
        .where('status', '==', 'confirmed')
        .where('date', '==', date);

      const [overrideSnap, confirmedSnap] = await Promise.all([
        tx.get(overrideRef),
        tx.get(confirmedQuery),
      ]);

      const weekly = cfg.weekly;
      const dow = dayOfWeek(date);
      const weeklySlots = weekly[dow] ?? [];

      const existing = overrideSnap.exists ? overrideSnap.data()! : null;
      const currentOverride: DayOverride | undefined = existing
        ? {
            type: existing.type as DayOverride['type'],
            slots: existing.slots as boolean[] | undefined,
          }
        : undefined;

      const otherBlocks = confirmedSnap.docs.map((d) => {
        const s = d.data();
        return sessionToConfirmedBlock({
          startTime: s.startTime as string,
          endTime: s.endTime as string,
          location: s.location as LocationPref,
        });
      });

      // Recompute the day's availability against the CURRENT state (shared
      // composition — identical to book-time and the range view). Holiday
      // substitution is included so a slot the tutor's HOLIDAY schedule excludes
      // (but the weekly grid allows) cannot be confirmed into their downtime.
      const grid = computeDateAvailability(
        date,
        {
          weekly,
          holidayMode: cfg.holidayMode,
          holidaySchedules: cfg.holidaySchedules,
          holidayPeriods: cfg.holidayPeriods,
          override: currentOverride,
          confirmedBlocks: otherBlocks,
          paddingMin: paddingMinutes,
        },
        parisWallClockPosition(now),
        (await getConfigValue('bookingNoticeHours').catch(() => NOTICE_HOURS)),
      );

      // The raw session slots must all still be free.
      const rawStart = timeToSlotIndex(startTime);
      const rawEnd = timeToSlotIndex(endTime);
      for (let i = rawStart; i < rawEnd; i++) {
        if (!grid[i]) {
          throw new HttpsError('failed-precondition', 'This time is no longer available');
        }
      }

      // ── Build the restorable override (read-modify-write) ──
      // NOTE on holiday dates: study-core's availability precedence is
      // `holidayGrid ?? customOverride ?? weekly`, so on a holiday-period date a
      // custom override's slots are IGNORED — the claim we AND into the override
      // below is INVISIBLE to availability computation. There, the operative
      // double-booking guard is the confirmed-sessions subtraction (this session
      // is now `confirmed`, so getTutorAvailability and bookSession subtract it).
      // We still write the override ledger for restorability and off-holiday dates.
      const block = paddedBlock(startTime, endTime, location, paddingMinutes);
      const mergedOverride = buildMergedOverride({
        existing,
        date,
        weeklySlots,
        block,
        entry: { sessionId, startIdx: block.start, endIdx: block.end },
        now,
      });

      // A provider proposal confirm also stamps the family's chosen roster +
      // accepting parent's name (denormalized pre-tx above). A family-initiated
      // confirm leaves the book-time roster untouched.
      const confirmUpdate: Record<string, unknown> = {
        status: 'confirmed',
        confirmedAt: now,
        updatedAt: now,
      };
      if (providerConfirmDenorm) {
        confirmUpdate.studentIds = providerConfirmDenorm.studentIds;
        confirmUpdate.students = providerConfirmDenorm.students;
        confirmUpdate.parentName = providerConfirmDenorm.parentName;
      }
      tx.update(sessionRef, confirmUpdate);
      tx.set(overrideRef, mergedOverride);

      return {
        action: 'confirm' as const,
        type: 'one_time' as const,
        familyId,
        tutorUserId,
        respondedByFamily,
        date,
        block,
      };
    });

    // ── POST-transaction: auto-decline overlapping one_time pendings (confirm) ──
    // one_time: the single claimed date. recurring: every scheduled date. Only
    // dated one_time pendings can collide (a recurring pending carries no date).
    const autoDeclined: { sessionId: string; familyId: string }[] = [];
    if (outcome.action === 'confirm') {
      const claimDates =
        outcome.type === 'recurring' ? outcome.scheduledDates : [outcome.date];
      const seen = new Set<string>();
      for (const claimDate of claimDates) {
        const pendingSnap = await db
          .collection('study-sessions')
          .where('tutorUserId', '==', outcome.tutorUserId)
          .where('status', '==', 'pending')
          .where('date', '==', claimDate)
          .get();
        for (const doc of pendingSnap.docs) {
          if (doc.id === sessionId || seen.has(doc.id)) continue;
          const p = doc.data();
          if (p.type !== 'one_time') continue;
          const pb = paddedBlock(
            p.startTime as string,
            p.endTime as string,
            p.location as LocationPref,
            (p.paddingMinutes as number) ?? 0,
          );
          if (!overlaps(outcome.block.start, outcome.block.end, pb.start, pb.end)) continue;
          await doc.ref.update({
            status: 'declined',
            statusReason: 'slot_taken',
            updatedAt: new Date(),
          });
          seen.add(doc.id);
          autoDeclined.push({ sessionId: doc.id, familyId: p.familyId as string });
        }
      }
    }

    // ── Notifications ──
    // The tutor whose schedule was claimed (keyed on the session, not the caller
    // — for a provider proposal the caller is the family).
    const tutorDoc = await db.collection('users').doc(outcome.tutorUserId).get();
    const tutorUser = tutorDoc.data();
    const tutorName = `${tutorUser?.firstName || ''} ${tutorUser?.lastName || ''}`.trim() || 'Your tutor';

    // Each auto-declined family (their slot got taken). Generalized copy: the slot
    // could have been taken by another family's booking OR by a family accepting a
    // tutor's proposal — either way it "is no longer available".
    for (const ad of autoDeclined) {
      await notifyAllParents({
        familyId: ad.familyId,
        prefCategory: 'cancelled',
        app: 'study',
        type: 'study_session_declined',
        title: 'Session no longer available',
        body: `That time with ${tutorName} is no longer available.`,
        emailSubject: `Session time no longer available — ${tutorName}`,
        emailBody: `
          <p>The time you requested with <strong>${escapeHtml(tutorName)}</strong> is no longer available.</p>
          <p>You can request another time.</p>
          <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
        `,
        data: { sessionId: ad.sessionId },
      });
      await writeUserActivity(uid, 'session_auto_declined', { sessionId: ad.sessionId });
    }

    if (outcome.respondedByFamily) {
      // ── Provider proposal: the FAMILY responded → notify the TUTOR ──
      // (bookSession's tutor-notify block pattern: in-app doc + email + push,
      // respecting the tutor's confirmed/cancelled prefs.)
      const familyName = (peekSession.familyName as string) || 'A family';
      const tutorEmail = tutorUser?.email as string | undefined;
      const isConfirm = outcome.action === 'confirm';
      const prefs = isConfirm ? tutorUser?.notifPrefs?.confirmed : tutorUser?.notifPrefs?.cancelled;
      const notifType = isConfirm ? 'study_session_confirmed' : 'study_session_declined';
      const title = isConfirm ? 'Proposal accepted' : 'Proposal declined';
      const body = isConfirm
        ? `${familyName} accepted your session proposal.`
        : `${familyName} declined your session proposal.`;
      // Record the actual send outcomes, not assumptions.
      let emailSent = false;
      if (prefs?.email !== false && tutorEmail) {
        emailSent = await sendNotificationEmail(
          tutorEmail,
          title,
          `<p><strong>${escapeHtml(familyName)}</strong> ${isConfirm ? 'accepted' : 'declined'} your session proposal.</p>
           <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/tutor/sessions" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>`,
          'study',
        );
      }
      // Send push before the doc write so pushSent records the real outcome.
      let pushSent = false;
      if (prefs?.push !== false) {
        pushSent = await sendPushNotification(outcome.tutorUserId, title, body, { sessionId, type: notifType }, 'study');
      }
      await db.collection('notifications').add({
        recipientUserId: outcome.tutorUserId,
        type: notifType,
        title,
        body,
        data: { sessionId },
        read: false,
        channels: ['email', 'push'],
        emailSent,
        pushSent,
        createdAt: now,
      });
    } else if (outcome.action === 'confirm' && outcome.type === 'recurring') {
      const count = outcome.scheduledDates.length;
      const first = outcome.scheduledDates[0];
      const skippedNote = outcome.skippedDates.length
        ? `<p>Some dates could not be scheduled (already booked, or a school holiday): ${outcome.skippedDates.join(', ')}.</p>`
        : '';
      await notifyAllParents({
        familyId: outcome.familyId,
        prefCategory: 'confirmed',
        app: 'study',
        type: 'study_session_confirmed',
        title: 'Recurring sessions confirmed',
        body: `${tutorName} confirmed your recurring tutoring sessions.`,
        emailSubject: `Recurring sessions confirmed — ${tutorName}`,
        emailBody: `
          <p><strong>${escapeHtml(tutorName)}</strong> confirmed your recurring tutoring sessions.</p>
          <p><strong>${count}</strong> session${count === 1 ? '' : 's'} scheduled, starting <strong>${first}</strong>.</p>
          ${skippedNote}
          <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
        `,
        data: { sessionId },
      });
    } else if (outcome.action === 'confirm') {
      await notifyAllParents({
        familyId: outcome.familyId,
        prefCategory: 'confirmed',
        app: 'study',
        type: 'study_session_confirmed',
        title: 'Session confirmed',
        body: `${tutorName} confirmed your tutoring session.`,
        emailSubject: `Session confirmed — ${tutorName}`,
        emailBody: `
          <p><strong>${escapeHtml(tutorName)}</strong> confirmed your tutoring session.</p>
          <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
        `,
        data: { sessionId },
      });
    } else {
      await notifyAllParents({
        familyId: outcome.familyId,
        prefCategory: 'cancelled',
        app: 'study',
        type: 'study_session_declined',
        title: 'Session declined',
        body: `${tutorName} declined your tutoring session request.`,
        emailSubject: `Session declined — ${tutorName}`,
        emailBody: `
          <p><strong>${escapeHtml(tutorName)}</strong> declined your tutoring session request.</p>
          <p>You can request another time or another tutor.</p>
          <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
        `,
        data: { sessionId },
      });
    }

    if (guardianActor) {
      await notifyChildOfGuardianAction(
        outcome.tutorUserId,
        'A parent of your family declined a session request for you.',
        { sessionId },
      );
    }

    await writeUserActivity(
      uid,
      outcome.action === 'confirm' ? 'session_confirmed' : 'session_declined',
      { sessionId, ...(guardianActor ? { actorRole: 'guardian' } : {}) },
    );

    if (outcome.action === 'confirm' && outcome.type === 'recurring') {
      return {
        success: true,
        confirmed: true,
        scheduledDates: outcome.scheduledDates,
        skippedDates: outcome.skippedDates,
      };
    }
    return { success: true };
  },
);
