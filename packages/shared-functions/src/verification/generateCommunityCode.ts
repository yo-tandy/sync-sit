import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import * as crypto from 'crypto';

export const generateCommunityCode = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== 'parent') {
      throw new HttpsError('permission-denied', 'Only parents can request community verification');
    }

    const familyId = userDoc.data()?.familyId;
    if (!familyId) {
      throw new HttpsError('failed-precondition', 'No family associated');
    }

    // Check if family is already fully verified
    const familyDoc = await db.collection('families').doc(familyId).get();
    if (familyDoc.data()?.verification?.isFullyVerified) {
      throw new HttpsError('failed-precondition', 'Family is already verified');
    }

    // Delete any existing unused codes for this family
    const existingCodes = await db.collection('communityVerificationCodes')
      .where('familyId', '==', familyId)
      .where('used', '==', false)
      .get();

    const batch = db.batch();
    for (const doc of existingCodes.docs) {
      batch.delete(doc.ref);
    }
    if (!existingCodes.empty) {
      await batch.commit();
    }

    // Generate 6-char alphanumeric code
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    await db.collection('communityVerificationCodes').doc(code).set({
      code,
      familyId,
      requestedByUserId: uid,
      expiresAt,
      used: false,
      createdAt: now,
    });

    await writeUserActivity(uid, 'community_code_generated', { familyId });

    return { code, expiresAt: expiresAt.toISOString() };
  }
);
