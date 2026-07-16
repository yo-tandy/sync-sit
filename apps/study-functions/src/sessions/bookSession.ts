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
import type { User, DayOfWeek } from '@ejm/shared-core';
import type {
  StudyUser,
  TutorProfile,
  SubjectOffering,
  LocationPref,
} from '@ejm/study-core';
import {
  computeDayAvailability,
  getSchoolYearsInRange,
  dayOfWeek,
  type ConfirmedBlock,
  type DayOverride,
} from '@ejm/study-core';
import { bookSessionInputSchema } from '../validation/session.js';

/** Notice window: families cannot book within this many hours of "now". */
const NOTICE_HOURS = 24;
const SLOT_MINUTES = 15;

type WeeklyGrid = Partial<Record<DayOfWeek, boolean[]>>;

/**
 * Best-effort single-date availability grid for the requested tutor+date.
 *
 * This mirrors the per-date computation getTutorAvailability performs so the
 * family sees the same picture at book time — weekly grid, per-date override,
 * holiday-period substitution, confirmed-session subtraction, and the notice
 * cutoff. It is deliberately BEST-EFFORT: pending sessions never block (only
 * confirmed blocks are subtracted), and the authoritative claim is the confirm
 * transaction (PR 3). A pass here only means "worth requesting".
 */
async function computeSingleDateAvailability(
  tutorUserId: string,
  date: string,
  paddingMin: number,
): Promise<boolean[]> {
  const dow = dayOfWeek(date);

  const scheduleSnap = await db.collection('schedules').doc(tutorUserId).get();
  const schedule = scheduleSnap.data();
  const weekly: WeeklyGrid = (schedule?.weekly as WeeklyGrid) ?? {};
  const holidayMode = schedule?.holidayMode as string | undefined;
  const holidaySchedules =
    (schedule?.holidaySchedules as Record<string, WeeklyGrid> | undefined) ??
    undefined;

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

  // Holiday-period grid substitution (only when holidayMode is 'different').
  let holidayGrid: boolean[] | undefined;
  if (holidayMode === 'different') {
    const years = getSchoolYearsInRange(date, date);
    const holidaySnaps = await Promise.all(
      years.map((y) => db.collection('holidays').doc(y).get()),
    );
    const periods: { name: string; startDate: string; endDate: string }[] = [];
    for (const snap of holidaySnaps) {
      const p = snap.data()?.periods as typeof periods | undefined;
      if (p) periods.push(...p);
    }
    const period = periods.find((p) => date >= p.startDate && date <= p.endDate);
    if (period) holidayGrid = holidaySchedules?.[period.name]?.[dow];
  }

  // Confirmed sessions on this date → blocks subtracted from the grid.
  // Uses the (tutorUserId, status, date) composite index.
  const sessionsSnap = await db
    .collection('study-sessions')
    .where('tutorUserId', '==', tutorUserId)
    .where('status', '==', 'confirmed')
    .where('date', '==', date)
    .get();
  const confirmedBlocks: ConfirmedBlock[] = [];
  for (const doc of sessionsSnap.docs) {
    const s = doc.data();
    if (!s.date) continue;
    confirmedBlocks.push({
      startIdx: timeToSlotIndex(s.startTime as string),
      endIdx: timeToSlotIndex(s.endTime as string),
      location: s.location as LocationPref,
    });
  }

  return computeDayAvailability({
    date,
    weeklySlots: weekly[dow] ?? [],
    override,
    holidayGrid,
    confirmedBlocks,
    paddingMin,
    nowParis: parisWallClockPosition(new Date()),
    noticeHours: NOTICE_HOURS,
  });
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

    // ── 24h minimum notice (Paris wall clock, DST-safe) ──
    const now = new Date();
    const sessionStart = parisWallTimeToUtc(date, startTime);
    if (sessionStart.getTime() < now.getTime() + NOTICE_HOURS * 60 * 60 * 1000) {
      throw new HttpsError(
        'failed-precondition',
        'Sessions must be booked at least 24 hours in advance',
      );
    }

    // ── Students must all belong to the caller's family; denormalize name+age ──
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

    // ── Best-effort availability pre-check (NOT the lock — confirm is) ──
    const paddingMinutes = tutor.paddingMin ?? 0;
    const startIdx = timeToSlotIndex(startTime);
    const endIdx = startIdx + sessionLengthMinutes / SLOT_MINUTES;
    const grid = await computeSingleDateAvailability(tutorUserId, date, paddingMinutes);
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
      .where('date', '==', date)
      .where('startTime', '==', startTime)
      .get();
    if (!dupSnap.empty) {
      throw new HttpsError('already-exists', 'A pending request already exists for this time');
    }

    // ── Write the pending session (no override — pending is a proposal) ──
    const familyName: string = (familyData.familyName as string) || '';
    const parentName = `${callerUser?.firstName || ''} ${callerUser?.lastName || ''}`.trim();
    const tutorName = `${tutorUser.firstName || ''} ${tutorUser.lastName || ''}`.trim();

    const sessionRef = db.collection('study-sessions').doc();
    // Loosely typed for the write so the Admin SDK coerces Date → Timestamp
    // (the SessionDoc.*At fields are FirestoreTimestamp); shape matches SessionDoc.
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
      date,
      startTime,
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

    // ── Notify the tutor (respecting notifPrefs.newRequest) ──
    const notifPrefs = tutorUser.notifPrefs?.newRequest;
    const title = 'New session request';
    const body = `${familyName || 'A family'} requested a tutoring session.`;
    const emailBody = `
      <p>You have a new session request from <strong>${familyName || 'a family'}</strong>.</p>
      <p><strong>Subject:</strong> ${subject} (${level})</p>
      <p><strong>When:</strong> ${date} at ${startTime}–${endTime}</p>
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
