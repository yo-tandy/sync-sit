import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import { countEligibleActiveAdmins, lastAdminError } from './activeAdmins.js';

interface BlockUserInput {
  targetUserId: string;
}

/**
 * Toggle block/unblock a user.
 * If active -> set to blocked and disable Firebase Auth.
 * If blocked -> set to active and enable Firebase Auth.
 *
 * NEVER the last active admin (issue #500). Blocking disables the Auth
 * account in the same call, so a sole admin who blocks themselves (or the
 * only other admin) cannot sign back in to undo it -- zero usable admins,
 * recoverable only from the Firestore/Auth console. Same failure mode #421
 * closed for erasure, same guard: the status flip runs inside a transaction
 * that counts the OTHER eligible admins at commit time
 * (`countEligibleActiveAdmins`), so two admins blocking each other at once
 * cannot both pass -- the second transaction is retried against the first
 * one's write and refuses. Unblocking is never guarded (it only ever adds an
 * admin back), and non-admins are not counted at all.
 *
 * The Auth flip follows the commit rather than running alongside it: the
 * guard has to see the Firestore state settle first, and an Auth update
 * that fails after the doc is already `blocked` leaves a sign-in that the
 * `status` check refuses anyway.
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

    const { previousStatus, newStatus, disabled } = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'User not found');
      }
      const data = snap.data()!;
      const currentStatus = data.status as string | undefined;

      let next: { newStatus: 'blocked' | 'active'; disabled: boolean };
      if (currentStatus === 'active') {
        next = { newStatus: 'blocked', disabled: true };
      } else if (currentStatus === 'blocked') {
        next = { newStatus: 'active', disabled: false };
      } else {
        throw new HttpsError(
          'failed-precondition',
          `Cannot toggle block for user with status '${currentStatus}'`,
        );
      }

      if (next.newStatus === 'blocked' && data.isAdmin === true) {
        // The target is counted too (active admin, no marker), so "one" means
        // "only them".
        if ((await countEligibleActiveAdmins(tx)) <= 1) {
          throw lastAdminError(
            'This is the last active admin — appoint another admin before blocking them.',
          );
        }
      }

      tx.update(userRef, { status: next.newStatus });
      return { previousStatus: currentStatus, ...next };
    });

    await adminAuth.updateUser(targetUserId, { disabled });

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: newStatus === 'blocked' ? 'block_user' : 'unblock_user',
      targetUserId,
      details: { previousStatus, newStatus },
    });

    return { success: true, newStatus };
  }
);
