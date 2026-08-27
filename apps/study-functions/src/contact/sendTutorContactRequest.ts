import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getConfigValue } from '@ejm/shared-functions/config/adminConfig.js';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { escapeHtml, sendNotificationEmail, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import { getParentProfile } from '@ejm/shared-core';
import type { User } from '@ejm/shared-core';
import type { StudyUser, TutorProfile, SubjectOffering } from '@ejm/study-core';
import { sendTutorContactRequestSchema } from '../validation/contact.js';
import {
  DECLINE_COOLDOWN_MS,
  latestDeclineMs,
  repairTimestamplessDeclines,
} from './declineCooldown.js';


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

    // The pending guard stays initiator-agnostic: one open request per pair,
    // whichever side opened it, is the same conversation.
    if (existingSnap.docs.some((d) => d.data().status === 'pending')) {
      throw new HttpsError('already-exists', 'A pending request already exists for this tutor');
    }

    // ── Cooldown: only the TUTOR's decline of a request this family opened
    // silences the family (issue #207 PR4). A family that declined the
    // tutor's own approach said no to being contacted, not to contacting --
    // counting that decline here would let a tutor's unwanted approach lock
    // the family out of the tutor it actually wants. ──
    // Anchor any timestampless decline before reading the window, so failing
    // closed lasts a week rather than forever (issue #214).
    await repairTimestamplessDeclines(existingSnap.docs, 'family');
    const declinedMs = latestDeclineMs(existingSnap.docs.map((d) => d.data()), 'family');
    const declineCooldownMs = (await getConfigValue('declineCooldownDays').catch(() => DECLINE_COOLDOWN_MS / 86400_000)) * 86400_000;
    if (declinedMs !== null && Date.now() - declinedMs < declineCooldownMs) {
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
      <p>You have a new tutoring request from <strong>${escapeHtml(familyName || 'a family')}</strong>.</p>
      <p><strong>Subject:</strong> ${escapeHtml(subject)} (${escapeHtml(level)})</p>
      ${message ? `<p><strong>Message:</strong> ${escapeHtml(message)}</p>` : ''}
      <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/tutor" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Request</a></p>
    `;

    // Record the actual send outcomes, not assumptions.
    let emailSent = false;
    if (notifPrefs?.email !== false && tutorUser.email) {
      emailSent = await sendNotificationEmail(tutorUser.email, `New tutoring request from ${familyName || 'a family'}`, emailBody, 'study');
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
      emailSent,
      pushSent,
      createdAt: now,
    });

    await writeUserActivity(uid, 'tutor_contact_request_sent', { tutorUserId, requestId: requestRef.id });

    return { requestId: requestRef.id };
  },
);
