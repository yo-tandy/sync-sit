import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { escapeHtml, sendNotificationEmail, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import { getParentProfile } from '@ejm/shared-core';
import type { User } from '@ejm/shared-core';
import type { StudyUser } from '@ejm/study-core';
import { cancelContactRequestSchema } from '../validation/contact.js';

/**
 * A family withdraws its OWN pending contact request. Distinct from the tutor's
 * decline: cancelling is family-initiated and does NOT start the 7-day
 * re-request cooldown (that keys on 'declined' only in sendTutorContactRequest),
 * so the family may re-send immediately afterwards.
 */
export const cancelContactRequest = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = cancelContactRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { requestId } = parsed.data;

    // ── Caller gate: parent with a family. familyId derived server-side. ──
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerUser = callerDoc.data() as User | undefined;
    const callerParent = getParentProfile(callerUser);
    if (!callerParent || !callerParent.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can cancel contact requests');
    }
    const callerFamilyId = callerParent.familyId;

    const requestRef = db.collection('studyContactRequests').doc(requestId);
    const now = new Date();

    // Load → ownership check → pending check → cancel, atomically.
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Request not found');
      }
      const data = snap.data()!;
      // Ownership is by FAMILY, not the creating parent — any parent in the
      // family may cancel a request the family sent.
      if (data.familyId !== callerFamilyId) {
        throw new HttpsError('permission-denied', 'This request belongs to another family');
      }
      if (data.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'Only pending requests can be cancelled');
      }

      tx.update(requestRef, { status: 'cancelled', cancelledAt: now, updatedAt: now });

      return {
        tutorUserId: data.tutorUserId as string,
        familyName: (data.familyName as string) || '',
        subject: data.subject as string,
        level: data.level as string,
      };
    });

    // ── Notify the tutor (respecting notifPrefs.cancelled) ──
    const tutorDoc = await db.collection('users').doc(result.tutorUserId).get();
    const tutorUser = tutorDoc.data() as StudyUser | undefined;
    const notifPrefs = tutorUser?.notifPrefs?.cancelled;
    const title = 'Tutoring request withdrawn';
    const body = `${result.familyName || 'A family'} withdrew their tutoring request.`;
    const emailBody = `
      <p><strong>${escapeHtml(result.familyName || 'A family')}</strong> withdrew their tutoring request for <strong>${escapeHtml(result.subject)} (${escapeHtml(result.level)})</strong>.</p>
      <p>No action is needed.</p>
      <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/tutor" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Requests</a></p>
    `;

    // Record the actual send outcomes, not assumptions.
    let emailSent = false;
    if (notifPrefs?.email !== false && tutorUser?.email) {
      emailSent = await sendNotificationEmail(tutorUser.email, `Tutoring request withdrawn — ${result.familyName || 'a family'}`, emailBody, 'study');
    }
    let pushSent = false;
    if (notifPrefs?.push !== false) {
      pushSent = await sendPushNotification(result.tutorUserId, title, body, { requestId, type: 'study_contact_request_cancelled' }, 'study');
    }
    await db.collection('notifications').add({
      recipientUserId: result.tutorUserId,
      type: 'study_contact_request_cancelled',
      title,
      body,
      data: { requestId },
      read: false,
      channels: ['email', 'push'],
      emailSent,
      pushSent,
      createdAt: now,
    });

    await writeUserActivity(uid, 'tutor_contact_request_cancelled', { tutorUserId: result.tutorUserId, requestId });

    return { success: true };
  },
);
