import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { isBabysitter, type User } from '@ejm/shared-core';
import { getBabysitterProfile } from '@ejm/sit-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';

interface DeactivateUserInput {
  targetUserId: string;
}

/**
 * Toggle a babysitter's searchable flag (activate/deactivate from search results).
 * Only works on babysitter users.
 */
export const deactivateUser = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { targetUserId } = request.data as DeactivateUserInput;

    if (!targetUserId) {
      throw new HttpsError('invalid-argument', 'Missing targetUserId');
    }

    const userRef = db.collection('users').doc(targetUserId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const userData = userSnap.data()!;

    if (!isBabysitter(userData as User)) {
      throw new HttpsError('failed-precondition', 'Only babysitter accounts can be activated/deactivated');
    }

    const currentSearchable = getBabysitterProfile(userData as User)?.searchable === true;
    const newSearchable = !currentSearchable;

    await userRef.update({ 'profiles.babysitter.searchable': newSearchable });

    const action = newSearchable ? 'activate_user' : 'deactivate_user';

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action,
      targetUserId,
      details: { previousSearchable: currentSearchable, newSearchable },
    });

    return { searchable: newSearchable };
  }
);
