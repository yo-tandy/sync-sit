import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';

interface BlockUserInput {
  targetUserId: string;
}

/**
 * Toggle block/unblock a user.
 * If active -> set to blocked and disable Firebase Auth.
 * If blocked -> set to active and enable Firebase Auth.
 */
export const blockUser = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { targetUserId } = request.data as BlockUserInput;

    if (!targetUserId) {
      throw new HttpsError('invalid-argument', 'targetUserId is required');
    }

    const userRef = db.collection('users').doc(targetUserId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const currentStatus = userDoc.data()?.status;
    let newStatus: string;
    let disabled: boolean;

    if (currentStatus === 'active') {
      newStatus = 'blocked';
      disabled = true;
    } else if (currentStatus === 'blocked') {
      newStatus = 'active';
      disabled = false;
    } else {
      throw new HttpsError(
        'failed-precondition',
        `Cannot toggle block for user with status '${currentStatus}'`
      );
    }

    await Promise.all([
      userRef.update({ status: newStatus }),
      adminAuth.updateUser(targetUserId, { disabled }),
    ]);

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: newStatus === 'blocked' ? 'block_user' : 'unblock_user',
      targetUserId,
      details: { previousStatus: currentStatus, newStatus },
    });

    return { success: true, newStatus };
  }
);
