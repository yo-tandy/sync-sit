import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { parisWallTimeToUtc } from '@ejm/shared-functions/scheduled/parisTime.js';
import { timeToSlotIndex, slotIndexToTime } from '@ejm/shared-core';
import type { StudyUser, TutorProfile, SubjectOffering } from '@ejm/study-core';
import { proposeSessionInputSchema } from '../validation/session.js';
import { computeSingleDateAvailability } from '../availability/singleDateAvailability.js';

/** Notice window: a proposal's session cannot start within this many hours. */
const NOTICE_HOURS = 24;
const SLOT_MINUTES = 15;

/**
 * proposeSession — a tutor proposes a concrete one-time session to an APPROVED,
 * verified family (V1.1 feature 3, study-only v1). The tutor-side mirror of a
 * one_time bookSession: same gates (mirrored to the tutor-as-caller), same
 * best-effort availability pre-check, same duplicate guard, same "pending is a
 * proposal — it claims NOTHING" invariant. The FAMILY confirms later
 * (respondToSession, picking students), and that confirm runs the identical
 * transactional slot claim on the tutor's schedule a family-initiated confirm
 * does — only the roles flip.
 *
 * The written doc is `proposedBy: 'provider'`, createdByUserId === the tutor
 * (the study invariant proposedBy==='provider' ⟺ createdByUserId===tutorUserId),
 * with an EMPTY roster (studentIds/students []) and blank parentName — all filled
 * by the family at accept. No override, no instances: a proposal is a proposal.
 */
export const proposeSession = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = proposeSessionInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const {
      familyId,
      subject,
      level,
      date,
      startTime,
      sessionLengthMinutes,
      location,
      message,
      address,
      latLng,
    } = parsed.data;

    // ── Caller gate: an active, enrolled tutor ──
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerUser = callerDoc.data() as StudyUser | undefined;
    const tutor: TutorProfile | undefined = callerUser?.profiles?.tutor;
    if (!tutor) {
      throw new HttpsError('permission-denied', 'Only tutors can propose sessions');
    }
    if (callerUser?.status !== 'active') {
      throw new HttpsError('permission-denied', 'Your account is not active');
    }
    if (!tutor.enrollmentComplete) {
      throw new HttpsError('failed-precondition', 'You have not completed enrollment');
    }

    // ── Consent gate: the family must be one the tutor has approved ──
    if (!(tutor.approvedFamilies ?? []).includes(familyId)) {
      throw new HttpsError('permission-denied', 'You can only propose to approved families');
    }

    // ── Target family must exist and be fully verified (bookSession's gate) ──
    const familyDoc = await db.collection('families').doc(familyId).get();
    const familyData = familyDoc.data();
    if (!familyDoc.exists || !familyData) {
      throw new HttpsError('not-found', 'Family not found');
    }
    if (!familyData.verification?.isFullyVerified) {
      throw new HttpsError('permission-denied', 'The family is not fully verified');
    }

    // ── Live offering: the tutor still offers this subject+level; snapshot rate ──
    const offering = (tutor.subjects ?? []).find(
      (o: SubjectOffering) => o.subject === subject && o.levels.includes(level),
    );
    if (!offering) {
      throw new HttpsError('failed-precondition', 'You do not offer this subject/level');
    }
    const rate = offering.rate; // snapshotted server-side at propose time

    // ── Session length + location must be ones the tutor offers ──
    if (!(tutor.sessionLengthsMin ?? []).includes(sessionLengthMinutes)) {
      throw new HttpsError('failed-precondition', 'You do not offer this session length');
    }
    if (!(tutor.locationPrefs ?? []).includes(location)) {
      throw new HttpsError('failed-precondition', 'You do not offer this location');
    }

    const now = new Date();
    const paddingMinutes = tutor.paddingMin ?? 0;

    // ── 24h minimum notice (Paris wall clock, DST-safe) ──
    const sessionStart = parisWallTimeToUtc(date, startTime);
    if (sessionStart.getTime() < now.getTime() + NOTICE_HOURS * 60 * 60 * 1000) {
      throw new HttpsError(
        'failed-precondition',
        'Sessions must be proposed at least 24 hours in advance',
      );
    }

    // ── Best-effort availability pre-check (NOT the lock — the family's confirm
    // is). Runs the SAME single-date composition bookSession does, against the
    // tutor's OWN schedule (uid === the tutor here). ──
    const startIdx = timeToSlotIndex(startTime);
    const endIdx = startIdx + sessionLengthMinutes / SLOT_MINUTES;
    const grid = await computeSingleDateAvailability(uid, date, paddingMinutes);
    for (let i = startIdx; i < endIdx; i++) {
      if (!grid[i]) {
        throw new HttpsError('invalid-argument', 'slot not available');
      }
    }
    const endTime = slotIndexToTime(endIdx);

    // ── Duplicate-pending guard: same tutor+family+date+startTime already pending ──
    // Equality-only filters — Firestore serves this without a composite index
    // (same equality query bookSession's one_time duplicate guard uses).
    const dupSnap = await db
      .collection('study-sessions')
      .where('tutorUserId', '==', uid)
      .where('familyId', '==', familyId)
      .where('status', '==', 'pending')
      .where('date', '==', date)
      .where('startTime', '==', startTime)
      .get();
    if (!dupSnap.empty) {
      throw new HttpsError('already-exists', 'A pending proposal already exists for this time');
    }

    // ── Denormalized display names (server-side; the tutor cannot read the
    // family doc, so familyName is snapshotted here). parentName is blank until
    // the accepting parent is known at confirm. ──
    const familyName: string = (familyData.familyName as string) || '';
    const tutorName = `${callerUser?.firstName || ''} ${callerUser?.lastName || ''}`.trim();

    // ── Write the pending proposal (no override — pending claims nothing) ──
    const sessionRef = db.collection('study-sessions').doc();
    const sessionDoc: Record<string, unknown> = {
      sessionId: sessionRef.id,
      familyId,
      tutorUserId: uid,
      createdByUserId: uid, // the proposing tutor (proposedBy invariant)
      proposedBy: 'provider',
      subject,
      level,
      rate,
      studentIds: [], // the family picks students at accept
      students: [],
      familyName,
      parentName: '', // filled by the accepting parent at confirm
      tutorName,
      type: 'one_time',
      date,
      startTime,
      endTime,
      sessionLengthMinutes,
      location,
      paddingMinutes,
      cancellationNoticeHours: tutor.cancellationNoticeHours ?? 0,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    if (message !== undefined) sessionDoc.message = message;
    if (address !== undefined) sessionDoc.address = address;
    if (latLng !== undefined) sessionDoc.latLng = latLng;
    await sessionRef.set(sessionDoc);

    // ── Notify the family (all parents) of the proposal ──
    await notifyAllParents({
      familyId,
      prefCategory: 'newRequest',
      type: 'study_session_proposed',
      title: 'New session proposal',
      body: `${tutorName || 'Your tutor'} proposed a tutoring session.`,
      emailSubject: `${tutorName || 'Your tutor'} proposed a session`,
      emailBody: `
        <p><strong>${tutorName || 'Your tutor'}</strong> proposed a tutoring session.</p>
        <p><strong>Subject:</strong> ${subject} (${level})</p>
        <p><strong>When:</strong> ${date} at ${startTime}–${endTime}</p>
        ${message ? `<p><strong>Message:</strong> ${message}</p>` : ''}
        <p>Accept it (and choose which students attend) or decline in the app.</p>
        <p style="margin-top: 16px;"><a href="https://sync-study.com/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View proposal</a></p>
      `,
      data: { sessionId: sessionRef.id },
    });

    await writeUserActivity(uid, 'session_proposed', {
      familyId,
      sessionId: sessionRef.id,
    });

    return { sessionId: sessionRef.id };
  },
);
