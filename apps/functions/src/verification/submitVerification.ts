import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { sendAdminNotification } from '../config/email.js';

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

    // Delete any existing verification docs of the same type for this family
    const existing = await db.collection('verifications')
      .where('familyId', '==', familyId)
      .where('type', '==', data.type)
      .get();

    if (!existing.empty) {
      const batch = db.batch();
      for (const doc of existing.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
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
    currentVerification[statusField] = 'pending';
    currentVerification.isFullyVerified = false;
    await familyRef.update({ verification: currentVerification });

    await writeUserActivity(uid, 'verification_submitted', { type: data.type, familyId });

    // Notify admin
    const userName = `${userDoc.data()?.firstName || ''} ${userDoc.data()?.lastName || ''}`.trim();
    const typeLabel = data.type === 'identity' ? 'Identity Document' : 'EJM Enrollment Document';
    await sendAdminNotification(
      `New verification request: ${typeLabel}`,
      `<p><strong>${userName}</strong> has submitted a new <strong>${typeLabel}</strong> for review.</p>
       <p style="color: #6B7280; font-size: 14px;">File: ${data.fileName}</p>`
    );

    return { verificationId: verificationRef.id };
  }
);
