import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from '../admin/verifyAdmin.js';
import { writeAuditLog } from '../admin/writeAuditLog.js';

interface ReviewInput {
  verificationId: string;
  decision: 'approved' | 'rejected';
  rejectionReason?: string;
}

export const reviewVerification = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { verificationId, decision, rejectionReason } = request.data as ReviewInput;

    if (!verificationId || !decision) {
      throw new HttpsError('invalid-argument', 'Missing verificationId or decision');
    }

    if (decision === 'rejected' && !rejectionReason) {
      throw new HttpsError('invalid-argument', 'Rejection reason is required');
    }

    const verificationRef = db.collection('verifications').doc(verificationId);
    const verificationDoc = await verificationRef.get();

    if (!verificationDoc.exists) {
      throw new HttpsError('not-found', 'Verification not found');
    }

    const verificationData = verificationDoc.data()!;
    const familyId = verificationData.familyId;

    // Legacy docs from the retired tutor_identity flow have no familyId.
    // Refuse them BEFORE any mutation: without this, the doc would be
    // approved/rejected and the family recompute below would then throw on
    // an undefined familyId, leaving a mutated doc with no audit entry.
    if (!familyId) {
      throw new HttpsError(
        'failed-precondition',
        'This verification is not linked to a family and cannot be reviewed',
      );
    }

    // Update verification doc
    const now = new Date();
    await verificationRef.update({
      status: decision,
      reviewedByAdminId: request.auth.uid,
      reviewedAt: now,
      ...(decision === 'rejected' && { rejectionReason }),
    });

    // Recompute family verification status
    const allVerifications = await db.collection('verifications')
      .where('familyId', '==', familyId)
      .get();

    let identityStatus: string = 'not_submitted';
    let enrollmentStatus: string = 'not_submitted';
    let isEjmFamily = false;

    for (const doc of allVerifications.docs) {
      const d = doc.data();
      const docStatus = doc.id === verificationId ? decision : d.status;

      if (d.type === 'identity') {
        if (docStatus === 'approved') identityStatus = 'approved';
        else if (docStatus === 'pending' && identityStatus !== 'approved') identityStatus = 'pending';
        else if (docStatus === 'rejected' && identityStatus === 'not_submitted') identityStatus = 'rejected';
      }

      if (d.type === 'ejm_enrollment') {
        if (docStatus === 'approved') {
          enrollmentStatus = 'approved';
          isEjmFamily = true;
        }
        else if (docStatus === 'pending' && enrollmentStatus !== 'approved') enrollmentStatus = 'pending';
        else if (docStatus === 'rejected' && enrollmentStatus === 'not_submitted') enrollmentStatus = 'rejected';
      }
    }

    // A community approval vouches for BOTH types (approveCommunityCode sets
    // them together), so it is a verification in its own right — not a
    // placeholder that documents overwrite. Recomputing from documents alone
    // would revoke it for any type the family has no live document for: the
    // family re-uploads next year's enrollment certificate, an admin approves
    // it, and their identity standing silently reverts to not_submitted.
    //
    // So the grant is the baseline, and documents only move a type off it when
    // an admin actually decided that type. An explicit rejection still wins —
    // that is a real decision about a real document (#218 review).
    const familyRef = db.collection('families').doc(familyId);
    const priorVerification = (await familyRef.get()).data()?.verification;
    const communityApprovedBy = priorVerification?.communityApprovedBy;

    if (communityApprovedBy) {
      if (identityStatus === 'not_submitted') identityStatus = 'approved';
      if (enrollmentStatus === 'not_submitted') {
        enrollmentStatus = 'approved';
        isEjmFamily = true;
      }
    }

    const isFullyVerified = identityStatus === 'approved' && enrollmentStatus === 'approved';

    await familyRef.update({
      verification: {
        identityStatus,
        enrollmentStatus,
        isFullyVerified,
        isEjmFamily,
        // Carrying this forward is what keeps the grant durable across
        // repeated document rounds.
        ...(communityApprovedBy ? { communityApprovedBy } : {}),
      },
    });

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: decision === 'approved' ? 'approve_verification' : 'reject_verification',
      targetUserId: verificationData.uploadedByUserId,
      details: { verificationId, type: verificationData.type, decision, rejectionReason: rejectionReason || null },
    });

    return { success: true, isFullyVerified };
  }
);
