import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';

export const lookupCommunityCode = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;

    // Verify approver is fully verified + EJM family
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== 'parent') {
      throw new HttpsError('permission-denied', 'Only parents can approve');
    }

    const approverFamilyId = userDoc.data()?.familyId;
    if (!approverFamilyId) {
      throw new HttpsError('failed-precondition', 'No family associated');
    }

    const approverFamily = await db.collection('families').doc(approverFamilyId).get();
    const approverVerification = approverFamily.data()?.verification;
    if (!approverVerification?.isFullyVerified || !approverVerification?.isEjmFamily) {
      throw new HttpsError('permission-denied', 'You must be a verified EJM family to approve others');
    }

    const { code } = request.data as { code: string };
    if (!code) {
      throw new HttpsError('invalid-argument', 'Code is required');
    }

    const codeDoc = await db.collection('communityVerificationCodes').doc(code.toUpperCase()).get();
    if (!codeDoc.exists) {
      throw new HttpsError('not-found', 'Invalid code');
    }

    const codeData = codeDoc.data()!;

    if (codeData.used) {
      throw new HttpsError('failed-precondition', 'This code has already been used');
    }

    if (codeData.expiresAt.toDate ? codeData.expiresAt.toDate() < new Date() : new Date(codeData.expiresAt) < new Date()) {
      throw new HttpsError('deadline-exceeded', 'This code has expired');
    }

    // Don't allow self-approval
    if (codeData.familyId === approverFamilyId) {
      throw new HttpsError('failed-precondition', 'You cannot approve your own family');
    }

    // Look up the requester's family and parent info
    const requesterFamily = await db.collection('families').doc(codeData.familyId).get();
    const requesterUser = await db.collection('users').doc(codeData.requestedByUserId).get();

    const familyName = requesterFamily.data()?.familyName || 'Unknown';
    const firstName = requesterUser.data()?.firstName || '';
    const lastName = requesterUser.data()?.lastName || '';

    return {
      familyName,
      firstName,
      lastName,
      familyId: codeData.familyId,
    };
  }
);
