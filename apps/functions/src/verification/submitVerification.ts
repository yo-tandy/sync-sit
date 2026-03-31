import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

interface SubmitVerificationInput {
  type: 'identity' | 'ejm_enrollment';
  fileUrl: string;
  fileName: string;
  // EJM enrollment fields (optional)
  childName?: string;
  childDob?: string;
  schoolYear?: string;
  classLevel?: string;
  signerName?: string;
}

export const submitVerification = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;

    // Verify caller is a parent
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== 'parent') {
      throw new HttpsError('permission-denied', 'Only parents can submit verification');
    }

    const familyId = userDoc.data()?.familyId;
    if (!familyId) {
      throw new HttpsError('failed-precondition', 'No family associated with this account');
    }

    const data = request.data as SubmitVerificationInput;

    if (!data.type || !data.fileUrl || !data.fileName) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    if (data.type === 'ejm_enrollment' && (!data.childName || !data.signerName)) {
      throw new HttpsError('invalid-argument', 'Enrollment documents require childName and signerName');
    }

    // For identity type, check if there's already a pending or approved one
    if (data.type === 'identity') {
      const existing = await db.collection('verifications')
        .where('familyId', '==', familyId)
        .where('type', '==', 'identity')
        .where('status', 'in', ['pending', 'approved'])
        .limit(1)
        .get();

      if (!existing.empty) {
        throw new HttpsError('already-exists', 'An identity verification is already pending or approved');
      }
    }

    const now = new Date();
    const verificationRef = db.collection('verifications').doc();

    await verificationRef.set({
      verificationId: verificationRef.id,
      familyId,
      uploadedByUserId: uid,
      type: data.type,
      status: 'pending',
      fileUrl: data.fileUrl,
      fileName: data.fileName,
      ...(data.type === 'ejm_enrollment' && {
        childName: data.childName,
        childDob: data.childDob || null,
        schoolYear: data.schoolYear || null,
        classLevel: data.classLevel || null,
        signerName: data.signerName,
      }),
      createdAt: now,
    });

    // Update family verification status
    const familyRef = db.collection('families').doc(familyId);
    const familyDoc = await familyRef.get();
    const currentVerification = familyDoc.data()?.verification || {
      identityStatus: 'not_submitted',
      enrollmentStatus: 'not_submitted',
      isFullyVerified: false,
      isEjmFamily: false,
    };

    const statusField = data.type === 'identity' ? 'identityStatus' : 'enrollmentStatus';
    if (currentVerification[statusField] === 'not_submitted' || currentVerification[statusField] === 'rejected') {
      await familyRef.update({
        [`verification.${statusField}`]: 'pending',
        'verification.isFullyVerified': false,
      });
    }

    await writeUserActivity(uid, 'verification_submitted', { type: data.type, familyId });

    return { verificationId: verificationRef.id };
  }
);
