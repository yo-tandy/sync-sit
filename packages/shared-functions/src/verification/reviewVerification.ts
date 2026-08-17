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

    const isFullyVerified = identityStatus === 'approved' && enrollmentStatus === 'approved';

    await db.collection('families').doc(familyId).update({
      verification: { identityStatus, enrollmentStatus, isFullyVerified, isEjmFamily },
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
