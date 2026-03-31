import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';

export const getVerificationStatus = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists || userDoc.data()?.role !== 'parent') {
      throw new HttpsError('permission-denied', 'Only parents can check verification status');
    }

    const familyId = userDoc.data()?.familyId;
    if (!familyId) {
      throw new HttpsError('failed-precondition', 'No family associated');
    }

    const familyDoc = await db.collection('families').doc(familyId).get();
    const verification = familyDoc.data()?.verification || {
      identityStatus: 'not_submitted',
      enrollmentStatus: 'not_submitted',
      isFullyVerified: false,
      isEjmFamily: false,
    };

    // Get all verification documents for this family
    const verificationsSnap = await db.collection('verifications')
      .where('familyId', '==', familyId)
      .orderBy('createdAt', 'desc')
      .get();

    const documents = verificationsSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        ...d,
        createdAt: d.createdAt?.toDate?.() ? d.createdAt.toDate().toISOString() : '',
        reviewedAt: d.reviewedAt?.toDate?.() ? d.reviewedAt.toDate().toISOString() : '',
      };
    });

    return { verification, documents };
  }
);
