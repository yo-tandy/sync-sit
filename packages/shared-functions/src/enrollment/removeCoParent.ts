import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { FieldValue } from 'firebase-admin/firestore';
import { writeUserActivity } from '../admin/writeAuditLog.js';

interface RemoveCoParentInput {
  targetUserId: string;
}

export const removeCoParent = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const { targetUserId } = request.data as RemoveCoParentInput;

    if (!targetUserId) {
      throw new HttpsError('invalid-argument', 'targetUserId is required');
    }

    if (targetUserId === uid) {
      throw new HttpsError('failed-precondition', 'You cannot remove yourself');
    }

    // Verify caller is a parent
    const callerDoc = await db.collection('users').doc(uid).get();
    if (!callerDoc.exists || callerDoc.data()?.role !== 'parent') {
      throw new HttpsError('permission-denied', 'Only parents can remove co-parents');
    }

    const callerFamilyId = callerDoc.data()?.familyId;
    if (!callerFamilyId) {
      throw new HttpsError('failed-precondition', 'No family associated');
    }

    // Verify target is in the same family
    const targetDoc = await db.collection('users').doc(targetUserId).get();
    if (!targetDoc.exists || targetDoc.data()?.familyId !== callerFamilyId) {
      throw new HttpsError('not-found', 'User is not in your family');
    }

    // Remove from family parentIds
    await db.collection('families').doc(callerFamilyId).update({
      parentIds: FieldValue.arrayRemove(targetUserId),
    });

    // Clear familyId on the target user
    await db.collection('users').doc(targetUserId).update({
      familyId: FieldValue.delete(),
    });

    await writeUserActivity(uid, 'remove_co_parent', { targetUserId, familyId: callerFamilyId });

    return { success: true };
  }
);
