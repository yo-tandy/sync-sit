import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';

export const removePreferredBabysitter = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const { babysitterUserId } = request.data as { babysitterUserId: string };

    if (!babysitterUserId) {
      throw new HttpsError('invalid-argument', 'babysitterUserId is required');
    }

    // Verify caller is a parent with a family
    const callerDoc = await db.collection('users').doc(uid).get();
    const caller = callerDoc.data();
    if (!caller || caller.role !== 'parent' || !caller.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can manage preferred babysitters');
    }

    // Remove from family's preferred list (idempotent via arrayRemove)
    await db.collection('families').doc(caller.familyId).update({
      preferredBabysitters: FieldValue.arrayRemove(babysitterUserId),
    });

    return { success: true };
  }
);
