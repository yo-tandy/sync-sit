import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import * as crypto from 'crypto';

export const generateInviteLink = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const { familyId } = request.data as { familyId: string };

    if (!familyId) {
      throw new HttpsError('invalid-argument', 'Missing familyId');
    }

    // Verify the caller is a member of this family
    const familySnap = await db.collection('families').doc(familyId).get();
    if (!familySnap.exists) {
      throw new HttpsError('not-found', 'Family not found');
    }

    const familyData = familySnap.data()!;
    if (!familyData.parentIds.includes(uid)) {
      throw new HttpsError('permission-denied', 'You are not a member of this family');
    }

    // Generate a unique token
    const token = crypto.randomBytes(32).toString('hex');

    // Store the invite link (expires in 7 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await db.collection('inviteLinks').doc(token).set({
      token,
      familyId,
      familyName: familyData.familyName || '',
      createdByUserId: uid,
      expiresAt,
      used: false,
      createdAt: new Date(),
    });

    return { token };
  }
);
