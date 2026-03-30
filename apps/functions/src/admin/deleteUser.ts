import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';

interface DeleteUserInput {
  targetUserId: string;
}

/**
 * Soft-delete a user: set status to 'deleted', disable Firebase Auth,
 * and cancel all active/pending appointments for this user.
 */
export const deleteUser = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { targetUserId } = request.data as DeleteUserInput;

    if (!targetUserId) {
      throw new HttpsError('invalid-argument', 'targetUserId is required');
    }

    const userRef = db.collection('users').doc(targetUserId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    // Set status to deleted and disable auth
    await Promise.all([
      userRef.update({ status: 'deleted' }),
      adminAuth.updateUser(targetUserId, { disabled: true }),
    ]);

    // Cancel all active/pending appointments for this user (as babysitter or family member)
    const [babysitterAppts, familyAppts] = await Promise.all([
      db
        .collection('appointments')
        .where('babysitterId', '==', targetUserId)
        .where('status', 'in', ['active', 'pending'])
        .get(),
      db
        .collection('appointments')
        .where('familyId', '==', targetUserId)
        .where('status', 'in', ['active', 'pending'])
        .get(),
    ]);

    const batch = db.batch();
    const allAppts = [...babysitterAppts.docs, ...familyAppts.docs];

    for (const appt of allAppts) {
      batch.update(appt.ref, {
        status: 'cancelled',
        statusReason: 'user_deleted',
      });
    }

    if (allAppts.length > 0) {
      await batch.commit();
    }

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'delete_user',
      targetUserId,
      details: { cancelledAppointments: allAppts.length },
    });

    return { success: true, cancelledAppointments: allAppts.length };
  }
);
