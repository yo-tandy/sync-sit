import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { ageFromDob } from '@ejm/shared-core';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from '../admin/verifyAdmin.js';
import { writeAuditLog } from '../admin/writeAuditLog.js';
import { notifyAllParents } from '../config/notifyParents.js';
import { escapeHtml } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';
import { GUARDIAN_SUCCESS } from './shared.js';

interface ForceRevokeData {
  childUid: string;
  reason: string;
}

/**
 * Admin force-revocation — the escape hatch revokeSupervision deliberately
 * refuses (its under-15 floor binds admin too). Under 15, ending supervision
 * cannot leave the account live: young participation is acceptable BECAUSE of
 * supervision, so the child is blocked + Auth-disabled and an alert records
 * the orphaning (the deleteUser last-parent semantics, applied deliberately).
 * 15+ is a plain revoke. A missing DOB cannot prove 15+ → treated as a minor.
 */
export const forceRevokeSupervision = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    await verifyAdmin(request.auth.uid);
    const { childUid, reason } = request.data as ForceRevokeData;
    if (!childUid || typeof childUid !== 'string') {
      throw new HttpsError('invalid-argument', 'childUid is required');
    }
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      throw new HttpsError('invalid-argument', 'A reason is required');
    }

    const linkRef = db.collection('guardianLinks').doc(childUid);
    const link = (await linkRef.get()).data();
    if (!link || link.status !== 'active') {
      throw new HttpsError('failed-precondition', 'This account has no active supervision.', {
        code: 'guardian/not-supervised',
      });
    }

    const childRef = db.collection('users').doc(childUid);
    const child = (await childRef.get()).data();
    const dob = child?.dateOfBirth?.toDate?.() ?? null;
    const isMinor = !dob || ageFromDob(dob) < 15;
    const now = new Date();

    await linkRef.update({ status: 'revoked', revokedAt: now, revokedByUid: request.auth.uid });
    const childUpdates: Record<string, unknown> = {
      governedBy: FieldValue.delete(),
      updatedAt: now,
    };
    if (isMinor) {
      childUpdates.status = 'blocked';
    }
    await childRef.update(childUpdates);
    if (isMinor) {
      try {
        await adminAuth.updateUser(childUid, { disabled: true });
      } catch (err: any) {
        if (err.code !== 'auth/user-not-found') throw err;
      }
      await db.collection('adminAlerts').add({
        type: 'guardian_forced_revoke_minor',
        createdAt: now,
        data: { childUid, familyId: link.familyId, revokedByUid: request.auth.uid },
      });
    }

    const kidName = child?.firstName || 'Your kid';
    await notifyAllParents({
      familyId: link.familyId as string,
      prefCategory: 'cancelled',
      type: 'supervision_revoked',
      title: 'Supervision ended',
      body: `An administrator ended supervision of ${kidName}'s account`,
      emailSubject: 'Supervision ended',
      emailBody: `<p>An administrator ended supervision of ${escapeHtml(kidName)}'s account.</p>`,
      data: { childUid },
    });
    const kidTitle = 'Supervision ended';
    const kidBody = isMinor
      ? 'An administrator ended supervision of your account. Your account has been deactivated — contact EJM admin.'
      : 'An administrator ended supervision of your account';
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
      adminUserId: request.auth.uid,
      action: 'guardian.force_revoke_supervision',
      targetUserId: childUid,
      details: { familyId: link.familyId, reason: reason.trim(), minorDeactivated: isMinor },
    });
    return GUARDIAN_SUCCESS;
  },
);
