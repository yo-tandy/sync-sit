import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { escapeHtml, sendNotificationEmail, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import {
  isActiveGuardianOf,
  notifyChildOfGuardianAction,
} from '@ejm/shared-functions/guardian/guardianAccess.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import { getParentProfile, resolveNotifPref } from '@ejm/shared-core';
import type { User } from '@ejm/shared-core';
import type { StudyUser } from '@ejm/study-core';
import { cancelContactRequestSchema } from '../validation/contact.js';

/**
 * The INITIATOR withdraws their own pending contact request — a family the one
 * it sent, or (since issue #207 PR4) a tutor the one they sent by answering a
 * published search, with an active guardian able to withdraw on the kid's
 * behalf. The other side never uses this door: a party who did not open the
 * request DECLINES it instead, through respondToTutorContactRequest or
 * respondToFamilyContactRequest.
 *
 * Distinct from a decline in effect as well as in wording: withdrawing does
 * NOT start the 7-day cooldown (which keys on 'declined' in both send
 * callables), so the withdrawing side may re-send immediately. That asymmetry
 * is the reason the caller gate matters — letting a parent "cancel" a tutor's
 * approach would tell the tutor a family withdrew a request it never sent AND
 * slip the family's real answer past the cooldown.
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

    // ── Caller gate. Withdrawing is the INITIATOR's lever, so who may call
    // this depends on who opened the request (issue #207 PR4):
    //   - family-initiated: any parent of the owning family (as before);
    //   - tutor-initiated: the tutor who opened it, or an active guardian of
    //     that tutor. A parent must DECLINE such a request instead — cancelling
    //     it would tell the tutor "the family withdrew their request", which
    //     they never sent, and would slip past the decline cooldown.
    // The caller's family is derived server-side, never taken from input. ──
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerUser = callerDoc.data() as User | undefined;
    const callerParent = getParentProfile(callerUser);
    const callerFamilyId = callerParent?.familyId ?? null;

    const requestRef = db.collection('studyContactRequests').doc(requestId);
    const now = new Date();

    // Resolve a guardian caller from a peek; the transaction below still gates
    // authoritatively (the respondToTutorContactRequest idiom).
    const peek = (await requestRef.get()).data();
    const guardianActor = Boolean(
      peek?.initiatedBy === 'tutor'
        && peek?.tutorUserId !== uid
        && (await isActiveGuardianOf(uid, peek?.tutorUserId as string)),
    );

    // Load → ownership check → pending check → cancel, atomically.
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Request not found');
      }
      const data = snap.data()!;
      if (data.initiatedBy === 'tutor') {
        // The tutor's own approach: theirs (or their guardian's) to withdraw.
        if (data.tutorUserId !== uid && !guardianActor) {
          throw new HttpsError(
            'permission-denied',
            'Only the tutor who sent this request can withdraw it',
          );
        }
      } else if (!callerFamilyId || data.familyId !== callerFamilyId) {
        // Ownership is by FAMILY, not the creating parent — any parent in the
        // family may cancel a request the family sent.
        throw new HttpsError('permission-denied', 'This request belongs to another family');
      }
      if (data.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'Only pending requests can be cancelled');
      }

      tx.update(requestRef, { status: 'cancelled', cancelledAt: now, updatedAt: now });

      return {
        tutorUserId: data.tutorUserId as string,
        familyId: data.familyId as string,
        familyName: (data.familyName as string) || '',
        tutorName: (data.tutorName as string) || '',
        subject: data.subject as string,
        level: data.level as string,
        byTutor: data.initiatedBy === 'tutor',
      };
    });

    // A tutor withdrawing their own approach notifies the FAMILY instead —
    // telling the tutor that "a family withdrew a request" they never sent
    // would be a lie in the opposite direction.
    if (result.byTutor) {
      await notifyAllParents({
        familyId: result.familyId,
        prefCategory: 'cancelled',
        app: 'study',
        type: 'study_contact_request_cancelled',
        title: 'A tutor withdrew their request',
        body: `${result.tutorName || 'A tutor'} withdrew their request for ${result.subject} (${result.level}).`,
        emailSubject: `Request withdrawn — ${result.tutorName || 'a tutor'}`,
        emailBody: `
          <p><strong>${escapeHtml(result.tutorName || 'A tutor')}</strong> withdrew their request for <strong>${escapeHtml(result.subject)} (${escapeHtml(result.level)})</strong>.</p>
          <p>No action is needed.</p>
          <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
        `,
        data: { requestId },
      });
      if (guardianActor) {
        await notifyChildOfGuardianAction(
          result.tutorUserId,
          'A parent of your family withdrew a tutoring request you had sent.',
          { requestId },
        );
      }
      await writeUserActivity(uid, 'tutor_contact_request_withdrawn', {
        requestId,
        familyId: result.familyId,
        ...(guardianActor ? { actorRole: 'guardian' } : {}),
      });
      return { success: true };
    }

    // ── Notify the tutor (respecting notifPrefs.study.cancelled) ──
    const tutorDoc = await db.collection('users').doc(result.tutorUserId).get();
    const tutorUser = tutorDoc.data() as StudyUser | undefined;
    const notifPrefs = resolveNotifPref(tutorUser?.notifPrefs, 'study', 'cancelled');
    const title = 'Tutoring request withdrawn';
    const body = `${result.familyName || 'A family'} withdrew their tutoring request.`;
    const emailBody = `
      <p><strong>${escapeHtml(result.familyName || 'A family')}</strong> withdrew their tutoring request for <strong>${escapeHtml(result.subject)} (${escapeHtml(result.level)})</strong>.</p>
      <p>No action is needed.</p>
      <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/tutor" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Requests</a></p>
    `;

    // Record the actual send outcomes, not assumptions.
    let emailSent = false;
    if (notifPrefs.email && tutorUser?.email) {
      emailSent = await sendNotificationEmail(tutorUser.email, `Tutoring request withdrawn — ${result.familyName || 'a family'}`, emailBody, 'study');
    }
    let pushSent = false;
    if (notifPrefs.push) {
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
