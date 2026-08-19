import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { ageFromDob } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeAuditLog } from '../admin/writeAuditLog.js';
import { notifyAllParents } from '../config/notifyParents.js';
import { escapeHtml } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';
import { GUARDIAN_SUCCESS, resolveGuardianCaller } from './shared.js';

interface RevokeData {
  childUid: string;
}

/**
 * End supervision — any supervising-family parent, or admin, and only for a
 * child ≥15 (the kid never self-revokes; there is no 18-auto-expiry). Admin
 * is ALSO bound by the under-15 floor here: the design's under-15 force-revoke
 * pairs with account deactivation, which is guardian-controls (PR 3) scope,
 * so until then admin gets the same refusal.
 */
export const revokeSupervision = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const callerUid = request.auth.uid;
    const { childUid } = request.data as RevokeData;
    if (!childUid || typeof childUid !== 'string') {
      throw new HttpsError('invalid-argument', 'childUid is required');
    }

    const { isAdminCaller, familyId } = await resolveGuardianCaller(callerUid);
    if (!isAdminCaller && !familyId) {
      throw new HttpsError(
        'permission-denied',
        'Only a parent with a family profile can manage supervision.',
        { code: 'guardian/not-a-family-parent' },
      );
    }

    // One indistinguishable refusal for "no link", "not active", and "someone
    // else's family" — a parent probing another family's child learns nothing.
    const linkRef = db.collection('guardianLinks').doc(childUid);
    const link = (await linkRef.get()).data();
    if (
      !link ||
      link.status !== 'active' ||
      (!isAdminCaller && link.familyId !== familyId)
    ) {
      throw new HttpsError('failed-precondition', 'This account is not under your supervision.', {
        code: 'guardian/not-supervised',
      });
    }

    // The ≥15 floor. A missing DOB cannot prove ≥15, so it also refuses.
    const child = (await db.collection('users').doc(childUid).get()).data();
    const dob = child?.dateOfBirth?.toDate?.() ?? null;
    if (!dob || ageFromDob(dob) < 15) {
      throw new HttpsError(
        'failed-precondition',
        'Supervision can only be ended once the child is 15.',
        { code: 'guardian/child-under-15' },
      );
    }

    const now = new Date();
    await linkRef.update({ status: 'revoked', revokedAt: now, revokedByUid: callerUid });
    // Mirror removed with the ACTIVE status; identityLocked deliberately
    // STAYS — the identity remains parent-attested.
    await db.collection('users').doc(childUid).update({
      governedBy: FieldValue.delete(),
      updatedAt: now,
    });

    const kidName = child?.firstName || 'Your kid';
    await notifyAllParents({
      familyId: link.familyId,
      prefCategory: 'cancelled',
      type: 'supervision_revoked',
      title: 'Supervision ended',
      body: `Supervision of ${kidName}'s account has ended`,
      emailSubject: 'Supervision ended',
      emailBody: `<p>Supervision of ${escapeHtml(kidName)}'s account has ended.</p>`,
      data: { childUid },
    });
    const kidTitle = 'Supervision ended';
    const kidBody = 'Your account is no longer supervised';
    await db.collection('notifications').add({
      recipientUserId: childUid,
      type: 'supervision_revoked',
      title: kidTitle,
      body: kidBody,
      data: { familyId: link.familyId },
      read: false,
      channels: ['push'],
      emailSent: false,
      pushSent: false,
      createdAt: now,
    });
    await sendPushNotification(childUid, kidTitle, kidBody, { type: 'supervision_revoked' });

    await writeAuditLog({
      adminUserId: callerUid,
      action: 'guardian.revoke_supervision',
      targetUserId: childUid,
      details: { familyId: link.familyId, byAdmin: isAdminCaller },
    });
    return GUARDIAN_SUCCESS;
  },
);
