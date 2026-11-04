import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import { assertNotLastActiveAdmin, countEligibleActiveAdmins } from './lastAdmin.js';

interface BlockUserInput {
  targetUserId: string;
}

/**
 * Toggle block/unblock a user.
 * If active -> set to blocked and disable Firebase Auth.
 * If blocked -> set to active and enable Firebase Auth.
 *
 * Refuses to block the LAST active admin (issue #500) — the same guard
 * `deleteUser` applies to erasure (#421/#490), sharing one implementation in
 * `./lastAdmin.js` so the two lockout paths cannot drift apart again.
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

    // Read, decide and write in ONE transaction (issue #500).
    //
    // Blocking disables the Firebase Auth account as well as setting
    // `status: 'blocked'`, so an admin who blocks the last active admin —
    // themselves, or the only other one — locks the platform out of its own
    // admin surface, recoverable only from the Firestore/Auth console. #490
    // closed exactly this hole for ERASURE and left it open here.
    //
    // The count has to happen inside the transaction, not before it: two
    // admins blocking each other at the same moment would both read "2 active
    // admins" outside one and both proceed, leaving zero. Inside, Firestore
    // retries the loser against the winner's committed write, so exactly one
    // can succeed — pinned by a concurrent test.
    const { currentStatus, newStatus, disabled } = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const status = snap.data()?.status;
      let next: string;
      let nextDisabled: boolean;

      if (status === 'active') {
        next = 'blocked';
        nextDisabled = true;
      } else if (status === 'blocked') {
        next = 'active';
        nextDisabled = false;
      } else {
        throw new HttpsError(
          'failed-precondition',
          `Cannot toggle block for user with status '${status}'`,
        );
      }

      // Only the BLOCKING direction can strand the platform. Unblocking adds
      // an admin back; it is always safe, and gating it would make a
      // zero-admin state unrecoverable through the product itself.
      if (next === 'blocked' && snap.data()?.isAdmin === true) {
        assertNotLastActiveAdmin(await countEligibleActiveAdmins(tx));
      }

      tx.update(userRef, { status: next });
      return { currentStatus: status, newStatus: next, disabled: nextDisabled };
    });

    // Auth AFTER the transaction commits, deliberately. `adminAuth` is not
    // transactional, so one of the two must go second; Firestore going first
    // means a failure here leaves the user `blocked` in Firestore but still
    // signable-in — and `status` is the hard gate the callables and rules
    // actually read, so that is the fail-safe direction. The reverse order
    // would disable the account while Firestore still said `active`.
    await adminAuth.updateUser(targetUserId, { disabled });

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: newStatus === 'blocked' ? 'block_user' : 'unblock_user',
      targetUserId,
      details: { previousStatus: currentStatus, newStatus },
    });

    return { success: true, newStatus };
  }
);
