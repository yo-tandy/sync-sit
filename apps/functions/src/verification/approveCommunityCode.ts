import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

export const approveCommunityCode = onCall(
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

    const codeRef = db.collection('communityVerificationCodes').doc(code.toUpperCase());
    const codeDoc = await codeRef.get();

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

    if (codeData.familyId === approverFamilyId) {
      throw new HttpsError('failed-precondition', 'You cannot approve your own family');
    }

    const now = new Date();

    // Mark code as used
    await codeRef.update({
      used: true,
      usedByUserId: uid,
      usedAt: now,
    });

    // Set requester's family as fully verified + EJM family
    await db.collection('families').doc(codeData.familyId).update({
      verification: {
        identityStatus: 'approved',
        enrollmentStatus: 'approved',
        isFullyVerified: true,
        isEjmFamily: true,
        communityApprovedBy: uid,
      },
    });

    await writeUserActivity(uid, 'community_approval_given', {
      approvedFamilyId: codeData.familyId,
      code,
    });

    await writeUserActivity(codeData.requestedByUserId, 'community_approval_received', {
      approvedByUserId: uid,
      code,
    });

    return { success: true };
  }
);
