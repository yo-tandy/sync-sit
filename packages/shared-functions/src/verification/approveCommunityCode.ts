import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getParentProfile, type User } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { supersedePendingVerifications } from './supersedePendingVerifications.js';

export const approveCommunityCode = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;

    // Verify approver is fully verified + EJM family
    const userDoc = await db.collection('users').doc(uid).get();
    const parent = getParentProfile(userDoc.data() as User | undefined);
    if (!parent) {
      throw new HttpsError('permission-denied', 'Only parents can approve');
    }

    const approverFamilyId = parent.familyId;
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

    // The family may have been verified since this code was handed out —
    // by an admin reviewing their documents, or by another parent acting on
    // the same request first. Refuse BEFORE the code is consumed, and say
    // that the request is stale rather than silently re-approving (#218).
    const requesterFamily = await db.collection('families').doc(codeData.familyId).get();
    if (requesterFamily.data()?.verification?.isFullyVerified) {
      throw new HttpsError(
        'failed-precondition',
        'This request is no longer valid — this family has already been verified',
        { reason: 'already_verified' },
      );
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

    // Document requests still queued for this family decide nothing now that
    // the community route has verified them — close them out (#218).
    //
    // Deliberately non-fatal: the approval has already landed above. Throwing
    // here would tell the approver "Approval failed" about an approval that
    // succeeded, and a retry would hit the already_verified guard — leaving no
    // route back. A stale queue entry is the lesser failure, and it is
    // recoverable by the next approval or by an admin.
    let supersededIds: string[] = [];
    try {
      supersededIds = await supersedePendingVerifications(codeData.familyId, now);
    } catch (err) {
      console.error('approveCommunityCode: failed to supersede pending verifications', {
        familyId: codeData.familyId,
        err,
      });
    }

    await writeUserActivity(uid, 'community_approval_given', {
      approvedFamilyId: codeData.familyId,
      code,
      supersededVerificationIds: supersededIds,
    });

    await writeUserActivity(codeData.requestedByUserId, 'community_approval_received', {
      approvedByUserId: uid,
      code,
    });

    return { success: true };
  }
);
