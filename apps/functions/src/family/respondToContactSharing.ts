import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';

interface RespondInput {
  requestId: string;
  action: 'approve' | 'decline';
}

/**
 * Babysitter responds to a contact sharing request from a family.
 * If approved, the family is added to the babysitter's approvedFamilies array,
 * making the babysitter's contact info visible to that family in search results.
 */
export const respondToContactSharing = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const { requestId, action } = request.data as RespondInput;

    if (!requestId || !action || !['approve', 'decline'].includes(action)) {
      throw new HttpsError('invalid-argument', 'requestId and action (approve/decline) are required');
    }

    // Load the request
    const requestDoc = await db.collection('contactSharingRequests').doc(requestId).get();
    if (!requestDoc.exists) {
      throw new HttpsError('not-found', 'Request not found');
    }

    const reqData = requestDoc.data()!;

    // Verify the caller is the babysitter for this request
    if (reqData.babysitterUserId !== uid) {
      throw new HttpsError('permission-denied', 'You are not the babysitter for this request');
    }

    const now = new Date();

    if (action === 'approve') {
      // Update request status
      await requestDoc.ref.update({
        status: 'approved',
        respondedAt: now,
      });

      // Add familyId to babysitter's approvedFamilies
      await db.collection('users').doc(uid).update({
        approvedFamilies: FieldValue.arrayUnion(reqData.familyId),
      });
    } else {
      // Decline
      await requestDoc.ref.update({
        status: 'declined',
        respondedAt: now,
      });
    }

    return { success: true };
  }
);
