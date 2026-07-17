import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { sendNotificationEmail } from '@ejm/shared-functions/config/email.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import {
  parisWallClockPosition,
  parisWallTimeToUtc,
} from '@ejm/shared-functions/scheduled/parisTime.js';
import {
  getParentProfile,
  timeToSlotIndex,
  slotIndexToTime,
} from '@ejm/shared-core';
import type { User, RecurringSlot, DayOfWeek } from '@ejm/shared-core';
import type {
  StudyUser,
  TutorProfile,
  SubjectOffering,
  LocationPref,
} from '@ejm/study-core';
import {
  getSchoolYearsInRange,
  expandRecurringDates,
  incrementDate,
  type DayOverride,
} from '@ejm/study-core';
import { parisDateString } from '@ejm/shared-functions/scheduled/parisTime.js';
import { bookSessionInputSchema } from '../validation/session.js';
import {
  computeDateAvailability,
  sessionToConfirmedBlock,
  type WeeklyGrid,
  type HolidayPeriod,
  type DateAvailabilityInputs,
} from '../availability/computeDateAvailability.js';

/** Notice window: families cannot book within this many hours of "now". */
const NOTICE_HOURS = 24;
const SLOT_MINUTES = 15;
const SLOTS_PER_DAY = 96;
/** How many weeks of candidate occurrences a recurring request is expanded over. */
const RECURRING_HORIZON_WEEKS = 8;

/** Human-readable weekday for notification copy. */
const DAY_LABELS: Record<DayOfWeek, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/**
 * Best-effort single-date availability grid for the requested tutor+date.
 *
 * Loads this one date's inputs and runs the SHARED per-date composition
 * (computeDateAvailability) — the same one getTutorAvailability and the confirm
 * transaction use — so the family sees, requests, and gets exactly one picture.
 * Deliberately BEST-EFFORT: pending sessions never block (only confirmed blocks
 * are subtracted); the authoritative claim is the confirm transaction.
 */
async function computeSingleDateAvailability(
  tutorUserId: string,
  date: string,
  paddingMin: number,
): Promise<boolean[]> {
  const scheduleSnap = await db.collection('schedules').doc(tutorUserId).get();
  const schedule = scheduleSnap.data();
  const weekly: WeeklyGrid = (schedule?.weekly as WeeklyGrid) ?? {};
  const holidayMode = schedule?.holidayMode as string | undefined;
  const holidaySchedules = schedule?.holidaySchedules as
    | Record<string, WeeklyGrid>
    | undefined;

  const overrideSnap = await db
    .collection('schedules')
    .doc(tutorUserId)
    .collection('overrides')
    .doc(date)
    .get();
  const overrideData = overrideSnap.data();
  const override: DayOverride | undefined = overrideData
    ? {
        type: overrideData.type as DayOverride['type'],
        slots: overrideData.slots as boolean[] | undefined,
      }
    : undefined;

  // Holiday periods for this date's school year (only when holidayMode differs).
  let holidayPeriods: HolidayPeriod[] = [];
  if (holidayMode === 'different') {
    const years = getSchoolYearsInRange(date, date);
    const holidaySnaps = await Promise.all(
      years.map((y) => db.collection('holidays').doc(y).get()),
    );
    for (const snap of holidaySnaps) {
      const p = snap.data()?.periods as HolidayPeriod[] | undefined;
      if (p) holidayPeriods.push(...p);
    }
  }

  // Confirmed sessions on this date → blocks subtracted from the grid.
  // Uses the (tutorUserId, status, date) composite index.
  const sessionsSnap = await db
    .collection('study-sessions')
    .where('tutorUserId', '==', tutorUserId)
    .where('status', '==', 'confirmed')
    .where('date', '==', date)
    .get();
  const confirmedBlocks = sessionsSnap.docs
    .filter((doc) => doc.data().date)
    .map((doc) => {
      const s = doc.data();
      return sessionToConfirmedBlock({
        startTime: s.startTime as string,
        endTime: s.endTime as string,
        location: s.location as LocationPref,
      });
    });

  // Scheduled recurring INSTANCES on this date → also subtracted. On a holiday-
  // schedule date a recurring occurrence's override claim is precedence-invisible
  // (holidayGrid ?? override ?? weekly), so this direct subtraction is the guard
  // that keeps a family from requesting a slot already held by an instance. Only
  // 'scheduled' instances block. Uses the (tutorUserId, status, date) CG index.
  const instancesSnap = await db
    .collectionGroup('instances')
    .where('tutorUserId', '==', tutorUserId)
    .where('status', '==', 'scheduled')
    .where('date', '==', date)
    .get();
  for (const doc of instancesSnap.docs) {
    const s = doc.data();
    confirmedBlocks.push(
      sessionToConfirmedBlock({
        startTime: s.startTime as string,
        endTime: s.endTime as string,
        location: s.location as LocationPref,
      }),
    );
  }

  const inputs: DateAvailabilityInputs = {
    weekly,
    holidayMode,
    holidaySchedules,
    holidayPeriods,
    override,
    confirmedBlocks,
    paddingMin,
  };
  return computeDateAvailability(date, inputs, parisWallClockPosition(new Date()), NOTICE_HOURS);
}

/**
 * bookSession — a verified family with an accepted contact request requests a
 * one-time tutoring session. Writes a `pending` SessionDoc and notifies the
 * tutor. A pending request is a PROPOSAL: it never claims schedule slots and
 * never writes an override — that happens only when the tutor confirms (PR 3).
 * The per-subject rate is snapshotted server-side from the live offering here.
 */
export const bookSession = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = bookSessionInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const {
      tutorUserId,
      subject,
      level,
      date,
      startTime,
      sessionLengthMinutes,
      location,
      studentIds,
      message,
      address,
      latLng,
      type,
      recurringSlot,
      schoolWeeksOnly,
      endDate,
    } = parsed.data;

    // ── Caller gate: parent with a fully-verified family ──
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerUser = callerDoc.data() as User | undefined;
    const callerParent = getParentProfile(callerUser);
    if (!callerParent || !callerParent.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can book sessions');
    }
    const familyId = callerParent.familyId; // server-derived; never from input
    const familyDoc = await db.collection('families').doc(familyId).get();
    const familyData = familyDoc.data();
    if (!familyData?.verification?.isFullyVerified) {
      throw new HttpsError('permission-denied', 'Family verification required before booking');
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

    // ── Consent gate: booking requires an accepted contact request ──
    if (!(tutor.approvedFamilies ?? []).includes(familyId)) {
      throw new HttpsError('permission-denied', 'Booking requires an accepted contact request');
    }

    // ── Live offering: tutor still offers this subject+level; snapshot the rate ──
    const offering = (tutor.subjects ?? []).find(
      (o: SubjectOffering) => o.subject === subject && o.levels.includes(level),
    );
    if (!offering) {
      throw new HttpsError('failed-precondition', 'Tutor does not offer this subject/level');
    }
    const rate = offering.rate; // snapshotted server-side at book time

    // ── Session length must be one the tutor offers ──
    if (!(tutor.sessionLengthsMin ?? []).includes(sessionLengthMinutes)) {
      throw new HttpsError('failed-precondition', 'Tutor does not offer this session length');
    }

    // ── Location must be one the tutor accepts ──
    if (!(tutor.locationPrefs ?? []).includes(location)) {
      throw new HttpsError('failed-precondition', 'Tutor does not offer this location');
    }

    const now = new Date();
    const paddingMinutes = tutor.paddingMin ?? 0;

    // ── Students must all belong to the caller's family; denormalize name+age ──
    // (shared by both booking types — the tutor cannot read the kids subcollection)
    const kidSnaps = await Promise.all(
      studentIds.map((id) =>
        db.collection('families').doc(familyId).collection('kids').doc(id).get(),
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

    // ── Shared denormalized display names ──
    const familyName: string = (familyData.familyName as string) || '';
    const parentName = `${callerUser?.firstName || ''} ${callerUser?.lastName || ''}`.trim();
    const tutorName = `${tutorUser.firstName || ''} ${tutorUser.lastName || ''}`.trim();

    const sessionRef = db.collection('study-sessions').doc();
    // A human-readable "when" summary for the tutor notification, filled per type.
    let whenLine: string;

    if (type === 'recurring') {
      // recurringSlot presence is guaranteed by the schema's superRefine.
      const slot = recurringSlot!;
      const slotStart = slot.startTime;

      // ── Slot math: the weekly session must fit within the day ──
      const startIdx = timeToSlotIndex(slotStart);
      const endIdx = startIdx + sessionLengthMinutes / SLOT_MINUTES;
      if (endIdx > SLOTS_PER_DAY) {
        throw new HttpsError('invalid-argument', 'Session cannot run past midnight');
      }
      const slotEnd = slotIndexToTime(endIdx);
      // The stored RecurringSlot carries the derived endTime (RecurringSlot shape).
      const slotWithEnd: RecurringSlot = { day: slot.day, startTime: slotStart, endTime: slotEnd };

      // ── Candidate occurrence dates ──
      // Anchor the expansion at the first date on/after now+24h (Paris): an
      // occurrence on today's weekday that would land inside the notice window
      // is skipped and the first occurrence rolls to next week. This is how the
      // 24h notice applies to a recurring series' FIRST occurrence.
      const fromDate = parisDateString(
        new Date(now.getTime() + NOTICE_HOURS * 60 * 60 * 1000),
      );
      // Upper bound of the window (for the holiday-year lookup); endDate only
      // truncates WITHIN it, so we still load holidays across the full horizon.
      let horizonEnd = fromDate;
      for (let i = 0; i < RECURRING_HORIZON_WEEKS * 7; i++) horizonEnd = incrementDate(horizonEnd);
      const rangeEnd = endDate !== undefined && endDate < horizonEnd ? endDate : horizonEnd;

      // French school-holiday periods across the window — drives schoolWeeksOnly.
      const holidayPeriods: HolidayPeriod[] = [];
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

      const candidates = expandRecurringDates(
        slotWithEnd,
        fromDate,
        RECURRING_HORIZON_WEEKS,
        endDate,
        schoolWeeksOnly,
        holidayPeriods,
      );
      if (candidates.length === 0) {
        // e.g. endDate before the first possible occurrence, or every candidate
        // falls in a school-holiday week under schoolWeeksOnly.
        throw new HttpsError('invalid-argument', 'No valid session dates in the recurring window');
      }

      // ── Best-effort: at least one candidate must currently be bookable ──
      // Pending never claims a slot; the tutor's confirm (PR 3) recomputes every
      // date authoritatively. This mirrors the one_time best-effort pre-check.
      let anyAvailable = false;
      for (const cand of candidates) {
        const grid = await computeSingleDateAvailability(tutorUserId, cand, paddingMinutes);
        let ok = true;
        for (let i = startIdx; i < endIdx; i++) {
          if (!grid[i]) { ok = false; break; }
        }
        if (ok) { anyAvailable = true; break; }
      }
      if (!anyAvailable) {
        throw new HttpsError('invalid-argument', 'slot not available');
      }

      // ── Duplicate-pending guard: same family+tutor+weekday+start already pending ──
      // Equality-only query (no composite index); recurringSlots is an
      // array-of-objects Firestore cannot filter on, so match the slot in memory.
      const dupSnap = await db
        .collection('study-sessions')
        .where('familyId', '==', familyId)
        .where('tutorUserId', '==', tutorUserId)
        .where('status', '==', 'pending')
        .get();
      const isDuplicate = dupSnap.docs.some((d) => {
        const s = d.data();
        return (
          s.type === 'recurring' &&
          Array.isArray(s.recurringSlots) &&
          (s.recurringSlots as RecurringSlot[]).some(
            (rs) => rs.day === slot.day && rs.startTime === slotStart,
          )
        );
      });
      if (isDuplicate) {
        throw new HttpsError('already-exists', 'A pending recurring request already exists for this slot');
      }

      // ── Write the pending series doc ──
      // Loosely typed so the Admin SDK coerces Date → Timestamp. DELIBERATE shape:
      //   • NO top-level `date`. Both session lists sort by `createdAt` (not
      //     `date`), so a series anchor is not needed for sorting; and the shared
      //     availability path subtracts confirmed sessions via
      //     `where(status=='confirmed' && date==X)` — once this series is confirmed
      //     (PR 3 Task 2) a top-level `date` would make the PARENT be subtracted as
      //     a block, double-counting against the per-date instances that actually
      //     carry the claim. The dated, availability-participating docs are the
      //     instances (id=date); the parent is the series envelope.
      //   • NO top-level `endTime` — the weekly time lives in recurringSlots.
      //   • NO instances / NO overrides — a pending series is a proposal.
      const sessionDoc: Record<string, unknown> = {
        sessionId: sessionRef.id,
        familyId,
        tutorUserId,
        createdByUserId: uid,
        subject,
        level,
        rate,
        studentIds,
        students,
        familyName,
        parentName,
        tutorName,
        type: 'recurring',
        startTime: slotStart, // constant weekly start (satisfies SessionDoc.startTime)
        sessionLengthMinutes,
        recurringSlots: [slotWithEnd],
        schoolWeeksOnly,
        location,
        paddingMinutes,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      if (endDate !== undefined) sessionDoc.endDate = endDate;
      if (message !== undefined) sessionDoc.message = message;
      if (address !== undefined) sessionDoc.address = address;
      if (latLng !== undefined) sessionDoc.latLng = latLng;
      await sessionRef.set(sessionDoc);

      whenLine =
        `Every ${DAY_LABELS[slot.day]} at ${slotStart}–${slotEnd}` +
        `${schoolWeeksOnly ? ' (school weeks only)' : ''}` +
        `${endDate ? `, until ${endDate}` : ''}`;
    } else {
      // ── one_time — a single concrete occurrence ──
      // date/startTime presence is guaranteed by the schema's superRefine.
      const bookingDate = date!;
      const bookingStart = startTime!;

      // ── 24h minimum notice (Paris wall clock, DST-safe) ──
      const sessionStart = parisWallTimeToUtc(bookingDate, bookingStart);
      if (sessionStart.getTime() < now.getTime() + NOTICE_HOURS * 60 * 60 * 1000) {
        throw new HttpsError(
          'failed-precondition',
          'Sessions must be booked at least 24 hours in advance',
        );
      }

      // ── Best-effort availability pre-check (NOT the lock — confirm is) ──
      const startIdx = timeToSlotIndex(bookingStart);
      const endIdx = startIdx + sessionLengthMinutes / SLOT_MINUTES;
      const grid = await computeSingleDateAvailability(tutorUserId, bookingDate, paddingMinutes);
      for (let i = startIdx; i < endIdx; i++) {
        if (!grid[i]) {
          throw new HttpsError('invalid-argument', 'slot not available');
        }
      }
      const endTime = slotIndexToTime(endIdx);

      // ── Duplicate-pending guard: same family+tutor+date+startTime already pending ──
      // Equality-only filters — Firestore serves this without a composite index.
      const dupSnap = await db
        .collection('study-sessions')
        .where('familyId', '==', familyId)
        .where('tutorUserId', '==', tutorUserId)
        .where('status', '==', 'pending')
        .where('date', '==', bookingDate)
        .where('startTime', '==', bookingStart)
        .get();
      if (!dupSnap.empty) {
        throw new HttpsError('already-exists', 'A pending request already exists for this time');
      }

      // ── Write the pending session (no override — pending is a proposal) ──
      const sessionDoc: Record<string, unknown> = {
        sessionId: sessionRef.id,
        familyId,
        tutorUserId,
        createdByUserId: uid,
        subject,
        level,
        rate,
        studentIds,
        students,
        familyName,
        parentName,
        tutorName,
        type: 'one_time',
        date: bookingDate,
        startTime: bookingStart,
        endTime,
        sessionLengthMinutes,
        location,
        paddingMinutes,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      if (message !== undefined) sessionDoc.message = message;
      if (address !== undefined) sessionDoc.address = address;
      if (latLng !== undefined) sessionDoc.latLng = latLng;
      await sessionRef.set(sessionDoc);

      whenLine = `${bookingDate} at ${bookingStart}–${endTime}`;
    }

    // ── Notify the tutor (respecting notifPrefs.newRequest) ──
    const notifPrefs = tutorUser.notifPrefs?.newRequest;
    const title = 'New session request';
    const body = `${familyName || 'A family'} requested a tutoring session.`;
    const emailBody = `
      <p>You have a new ${type === 'recurring' ? 'recurring ' : ''}session request from <strong>${familyName || 'a family'}</strong>.</p>
      <p><strong>Subject:</strong> ${subject} (${level})</p>
      <p><strong>When:</strong> ${whenLine}</p>
      ${message ? `<p><strong>Message:</strong> ${message}</p>` : ''}
      <p style="margin-top: 16px;"><a href="https://sync-study.com/tutor/sessions" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Request</a></p>
    `;

    if (notifPrefs?.email !== false && tutorUser.email) {
      await sendNotificationEmail(
        tutorUser.email,
        `New session request from ${familyName || 'a family'}`,
        emailBody,
      );
    }
    if (notifPrefs?.push !== false) {
      await sendPushNotification(tutorUserId, title, body, {
        sessionId: sessionRef.id,
        type: 'study_session_request',
      });
    }
    await db.collection('notifications').add({
      recipientUserId: tutorUserId,
      type: 'study_session_request',
      title,
      body,
      data: { sessionId: sessionRef.id },
      read: false,
      channels: ['email', 'push'],
      emailSent: notifPrefs?.email !== false,
      pushSent: false,
      createdAt: now,
    });

    await writeUserActivity(uid, 'session_requested', {
      tutorUserId,
      sessionId: sessionRef.id,
    });

    return { sessionId: sessionRef.id };
  },
);
