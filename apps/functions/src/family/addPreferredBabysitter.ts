import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';

export const addPreferredBabysitter = onCall(
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

    // Verify babysitter exists and is a babysitter
    const babysitterDoc = await db.collection('users').doc(babysitterUserId).get();
    if (!babysitterDoc.exists || babysitterDoc.data()?.role !== 'babysitter') {
      throw new HttpsError('not-found', 'Babysitter not found');
    }

    // Load family for name
    const familyDoc = await db.collection('families').doc(caller.familyId).get();
    const familyName = familyDoc.data()?.familyName || '';

    // Add to family's preferred list (idempotent via arrayUnion)
    await db.collection('families').doc(caller.familyId).update({
      preferredBabysitters: FieldValue.arrayUnion(babysitterUserId),
    });

    // Check if there's already a pending or existing sharing request for this pair
    const existingRequest = await db.collection('contactSharingRequests')
      .where('babysitterUserId', '==', babysitterUserId)
      .where('familyId', '==', caller.familyId)
      .limit(1)
      .get();

    if (existingRequest.empty) {
      // Write a pending notification doc (processed after 60s by scheduled function)
      await db.collection('contactSharingPending').add({
        babysitterUserId,
        familyId: caller.familyId,
        familyName,
        parentName: `${caller.firstName || ''} ${(caller.lastName || '').toUpperCase()}`.trim(),
        notifyAt: new Date(Date.now() + 60 * 1000), // 1 minute from now
        processed: false,
        createdAt: new Date(),
      });
    }

    return { success: true };
  }
);
