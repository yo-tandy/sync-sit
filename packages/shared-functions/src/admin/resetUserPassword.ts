import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';

interface ResetUserPasswordInput {
  targetUserId: string;
}

/**
 * Generate a password reset link for a user and return it.
 */
export const resetUserPassword = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { targetUserId } = request.data as ResetUserPasswordInput;

    if (!targetUserId) {
      throw new HttpsError('invalid-argument', 'targetUserId is required');
    }

    const userDoc = await db.collection('users').doc(targetUserId).get();

    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const email = userDoc.data()?.email;

    if (!email) {
      throw new HttpsError('failed-precondition', 'User has no email address');
    }

    const resetLink = await adminAuth.generatePasswordResetLink(email);

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'reset_user_password',
      targetUserId,
    });

    return { success: true, resetLink };
  }
);
