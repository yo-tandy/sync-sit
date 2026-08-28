import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getConfigValue } from '@ejm/shared-functions/config/adminConfig.js';
import { clampNoticeWindow } from '@ejm/shared-functions/schedule/lateCancellation.js';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { escapeHtml, sendNotificationEmail, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import { parisWallTimeToUtc } from '@ejm/shared-functions/scheduled/parisTime.js';
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
} from '@ejm/study-core';
import {
  getSchoolYearsInRange,
  expandRecurringDates,
  incrementDate,
  resolveEffectiveLocations,
  sanitizeDayLocations,
} from '@ejm/study-core';
import { parisDateString } from '@ejm/shared-functions/scheduled/parisTime.js';
import { bookSessionInputSchema } from '../validation/session.js';
import { computeSingleDateAvailability } from '../availability/singleDateAvailability.js';
import type { HolidayPeriod } from '../availability/computeDateAvailability.js';

const SLOT_MINUTES = 15;
const SLOTS_PER_DAY = 96;

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
      trialFirstSession,
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
      // Carries the same details as the per-slot tag rejections: this gate is
      // what fires when a stored tag's location was later removed from the
      // profile prefs, and the family deserves the location-specific message
      // there too, not a generic cannot-book.
      throw new HttpsError('failed-precondition', 'Tutor does not offer this location', {
        reason: 'location_not_offered',
      });
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
        new Date(now.getTime() + (await getConfigValue('bookingNoticeHours')) * 60 * 60 * 1000),
      );
      // Upper bound of the window (for the holiday-year lookup); endDate only
      // truncates WITHIN it, so we still load holidays across the full horizon.
      let horizonEnd = fromDate;
      const horizonWeeks = await getConfigValue('recurringHorizonWeeks');
      for (let i = 0; i < horizonWeeks * 7; i++) horizonEnd = incrementDate(horizonEnd);
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
        horizonWeeks,
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
        const { slots: grid } = await computeSingleDateAvailability(tutorUserId, cand, paddingMinutes);
        let ok = true;
        for (let i = startIdx; i < endIdx; i++) {
          if (!grid[i]) { ok = false; break; }
        }
        if (ok) { anyAvailable = true; break; }
      }
      if (!anyAvailable) {
        throw new HttpsError('invalid-argument', 'slot not available');
      }

      // ── Per-slot location tags (issue #166): a recurring series validates
      // against its WEEKLY cells — the tags on slot.day over the requested
      // range, regardless of any per-date override AND regardless of holiday
      // substitution (which the one-time path below DOES honour via
      // resolveDateLocationCells). Deliberate asymmetry: a series is a
      // standing weekly commitment, so it answers to the weekly tags even
      // when individual dates fall in an override or a holiday-substituted
      // period — a one-time booking on such a date may accept a location the
      // series rejects (owner decision: the tags constrain scheduling;
      // override-day tags are a follow-up). Effective
      // set = intersection of per-cell (override ?? profile prefs); legacy
      // docs (no weeklyLocations) fall back to profile prefs, which the
      // check above already passed. ──
      const scheduleSnap = await db.collection('schedules').doc(tutorUserId).get();
      const weeklyLocations = scheduleSnap.data()?.weeklyLocations as
        | Record<string, unknown>
        | undefined;
      const effectiveLocations = resolveEffectiveLocations(
        sanitizeDayLocations(weeklyLocations?.[slot.day]),
        startIdx,
        endIdx,
        tutor.locationPrefs ?? [],
      );
      if (!effectiveLocations.includes(location)) {
        // details.reason lets the client tell "this location is not offered
        // at this time" apart from a generic slot-taken invalid-argument —
        // the recurring weekly-cells check can diverge from the client's
        // per-occurrence heuristic, so the message must name the real cause.
        throw new HttpsError(
          'invalid-argument',
          'Tutor does not offer this location for this time slot',
          { reason: 'location_not_offered' },
        );
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
        cancellationNoticeHours: clampNoticeWindow(tutor.cancellationNoticeHours),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      if (endDate !== undefined) sessionDoc.endDate = endDate;
      // Omit-when-false (mirrors endDate): only a true opt-in is stored, so a
      // non-trial series carries no field at all.
      if (trialFirstSession) sessionDoc.trialFirstSession = true;
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

      // ── Minimum booking notice (bookingNoticeHours, Paris wall clock, DST-safe) ──
      const sessionStart = parisWallTimeToUtc(bookingDate, bookingStart);
      const noticeHours = await getConfigValue('bookingNoticeHours');

      if (sessionStart.getTime() < now.getTime() + noticeHours * 60 * 60 * 1000) {
        throw new HttpsError(
          'failed-precondition',
          `Sessions must be booked at least ${noticeHours} hours in advance`,
        );
      }

      // ── Best-effort availability pre-check (NOT the lock — confirm is) ──
      const startIdx = timeToSlotIndex(bookingStart);
      const endIdx = startIdx + sessionLengthMinutes / SLOT_MINUTES;
      const { slots: grid, locationCells } = await computeSingleDateAvailability(
        tutorUserId,
        bookingDate,
        paddingMinutes,
      );
      for (let i = startIdx; i < endIdx; i++) {
        if (!grid[i]) {
          throw new HttpsError('invalid-argument', 'slot not available');
        }
      }

      // ── Per-slot location tags (issue #166): the requested location must be
      // in the slot's EFFECTIVE set — intersection of per-cell (tag override
      // ?? profile prefs) across the covered cells. The client constraint is
      // UX only; this is the trust boundary. Legacy docs and override/holiday
      // dates resolve every cell to profile prefs (checked above). ──
      const effectiveLocations = resolveEffectiveLocations(
        locationCells,
        startIdx,
        endIdx,
        tutor.locationPrefs ?? [],
      );
      if (!effectiveLocations.includes(location)) {
        // Same distinguishable details as the recurring path: the client maps
        // this to a location-specific message instead of "slot taken".
        throw new HttpsError(
          'invalid-argument',
          'Tutor does not offer this location for this time slot',
          { reason: 'location_not_offered' },
        );
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
        cancellationNoticeHours: clampNoticeWindow(tutor.cancellationNoticeHours),
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
    // trialFirstSession is recurring-only; ignore it on the one_time path.
    const isTrialRequest = type === 'recurring' && trialFirstSession === true;
    const notifPrefs = tutorUser.notifPrefs?.newRequest;
    const title = 'New session request';
    const body = `${familyName || 'A family'} requested a tutoring session${isTrialRequest ? ' (first session as a trial)' : ''}.`;
    const emailBody = `
      <p>You have a new ${type === 'recurring' ? 'recurring ' : ''}session request from <strong>${escapeHtml(familyName || 'a family')}</strong>.</p>
      <p><strong>Subject:</strong> ${escapeHtml(subject)} (${escapeHtml(level)})</p>
      <p><strong>When:</strong> ${escapeHtml(whenLine)}</p>
      ${isTrialRequest ? `<p>The family would like the <strong>first session as a trial</strong>.</p>` : ''}
      ${message ? `<p><strong>Message:</strong> ${escapeHtml(message)}</p>` : ''}
      <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/tutor/sessions" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Request</a></p>
    `;

    // Record the actual send outcomes, not assumptions.
    let emailSent = false;
    if (notifPrefs?.email !== false && tutorUser.email) {
      emailSent = await sendNotificationEmail(
        tutorUser.email,
        `New session request from ${familyName || 'a family'}`,
        emailBody,
        'study',
      );
    }
    let pushSent = false;
    if (notifPrefs?.push !== false) {
      pushSent = await sendPushNotification(tutorUserId, title, body, {
        sessionId: sessionRef.id,
        type: 'study_session_request',
      }, 'study');
    }
    await db.collection('notifications').add({
      recipientUserId: tutorUserId,
      type: 'study_session_request',
      title,
      body,
      data: { sessionId: sessionRef.id },
      read: false,
      channels: ['email', 'push'],
      emailSent,
      pushSent,
      createdAt: now,
    });

    await writeUserActivity(uid, 'session_requested', {
      tutorUserId,
      sessionId: sessionRef.id,
    });

    return { sessionId: sessionRef.id };
  },
);
