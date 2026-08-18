import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { sendNotificationEmail } from '@ejm/shared-functions/config/email.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import { getParentProfile } from '@ejm/shared-core';
import type { User } from '@ejm/shared-core';
import type { StudyUser, TutorProfile, SubjectOffering } from '@ejm/study-core';
import { sendTutorContactRequestSchema } from '../validation/contact.js';

/** Cooldown before a family may re-request a tutor after a decline. */
const DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return 0;
}

export const sendTutorContactRequest = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = sendTutorContactRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { tutorUserId, subject, level, message } = parsed.data;

    // ── Caller gate: parent with a fully-verified family ──
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerUser = callerDoc.data() as User | undefined;
    const callerParent = getParentProfile(callerUser);
    if (!callerParent || !callerParent.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can contact tutors');
    }
    const familyId = callerParent.familyId; // derived server-side; never from input
    const familyDoc = await db.collection('families').doc(familyId).get();
    const familyData = familyDoc.data();
    if (!familyData?.verification?.isFullyVerified) {
      throw new HttpsError('permission-denied', 'Family verification required before contacting tutors');
    }

    // ── Not-self ──
    if (tutorUserId === uid) {
      throw new HttpsError('invalid-argument', 'You cannot send a contact request to yourself');
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

    // ── Live-offering check: tutor still offers this subject+level ──
    const offers = (tutor.subjects || []).some(
      (o: SubjectOffering) => o.subject === subject && o.levels.includes(level),
    );
    if (!offers) {
      throw new HttpsError('failed-precondition', 'Tutor does not offer this subject/level');
    }

    // ── Already-approved: contact already unlocked ──
    if ((tutor.approvedFamilies || []).includes(familyId)) {
      throw new HttpsError('failed-precondition', 'This family already has access to this tutor');
    }

    // ── Existing requests for this (family, tutor) pair ──
    // Two equality filters — Firestore serves this without a composite index.
    const existingSnap = await db.collection('studyContactRequests')
      .where('tutorUserId', '==', tutorUserId)
      .where('familyId', '==', familyId)
      .get();

    let latest: { status: string; createdAtMs: number } | null = null;
    for (const d of existingSnap.docs) {
      const data = d.data();
      if (data.status === 'pending') {
        throw new HttpsError('already-exists', 'A pending request already exists for this tutor');
      }
      const createdAtMs = toMillis(data.createdAt);
      if (!latest || createdAtMs >= latest.createdAtMs) {
        latest = { status: data.status as string, createdAtMs };
      }
    }

    // ── Cooldown: a decline within the last 7 days blocks re-requesting ──
    if (
      latest &&
      latest.status === 'declined' &&
      Date.now() - latest.createdAtMs < DECLINE_COOLDOWN_MS
    ) {
      throw new HttpsError(
        'resource-exhausted',
        'This tutor recently declined a request; please wait 7 days before requesting again',
      );
    }

    // ── Create the request ──
    const now = new Date();
    const familyName: string = familyData.familyName || '';
    const parentName = `${callerUser?.firstName || ''} ${callerUser?.lastName || ''}`.trim();
    // Denormalized for the FAMILY's requests list — rules do not let parents
    // read tutor user docs, so the name must live on the request itself.
    const tutorName = `${tutorUser.firstName || ''} ${tutorUser.lastName || ''}`.trim();

    const requestRef = db.collection('studyContactRequests').doc();
    const doc: Record<string, unknown> = {
      requestId: requestRef.id,
      tutorUserId,
      familyId,
      familyName,
      parentName,
      tutorName,
      createdByUserId: uid,
      subject,
      level,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    if (message !== undefined) doc.message = message;
    await requestRef.set(doc);

    // ── Notify the tutor (respecting notifPrefs.newRequest) ──
    const notifPrefs = tutorUser.notifPrefs?.newRequest;
    const title = 'New tutoring request';
    const body = `${familyName || 'A family'} is interested in tutoring.`;
    const emailBody = `
      <p>You have a new tutoring request from <strong>${familyName || 'a family'}</strong>.</p>
      <p><strong>Subject:</strong> ${subject} (${level})</p>
      ${message ? `<p><strong>Message:</strong> ${message}</p>` : ''}
      <p style="margin-top: 16px;"><a href="https://sync-study.com/tutor" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Request</a></p>
    `;

    if (notifPrefs?.email !== false && tutorUser.email) {
      await sendNotificationEmail(tutorUser.email, `New tutoring request from ${familyName || 'a family'}`, emailBody, 'study');
    }
    let pushSent = false;
    if (notifPrefs?.push !== false) {
      pushSent = await sendPushNotification(tutorUserId, title, body, { requestId: requestRef.id, type: 'study_contact_request' }, 'study');
    }
    await db.collection('notifications').add({
      recipientUserId: tutorUserId,
      type: 'study_contact_request',
      title,
      body,
      data: { requestId: requestRef.id },
      read: false,
      channels: ['email', 'push'],
      emailSent: notifPrefs?.email !== false,
      pushSent,
      createdAt: now,
    });

    await writeUserActivity(uid, 'tutor_contact_request_sent', { tutorUserId, requestId: requestRef.id });

    return { requestId: requestRef.id };
  },
);
