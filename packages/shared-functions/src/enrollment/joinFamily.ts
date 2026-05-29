import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { FieldValue } from 'firebase-admin/firestore';
import { joinFamilySchema } from '@ejm/shared';
import { writeUserActivity } from '../admin/writeAuditLog.js';

interface JoinFamilyData {
  token: string;
  email: string;
  verificationCode: string;
  password: string;
  firstName: string;
  lastName: string;
}

export const joinFamily = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const data = request.data as JoinFamilyData;

    // 0. Validate inputs
    const validationResult = joinFamilySchema.safeParse(data);
    if (!validationResult.success) {
      throw new HttpsError('invalid-argument', validationResult.error.issues[0]?.message || 'Invalid data');
    }
    if (!data.token) {
      throw new HttpsError('invalid-argument', 'Invite token is required');
    }

    // 1. Validate invite token
    const inviteSnap = await db.collection('inviteLinks').doc(data.token).get();
    if (!inviteSnap.exists) {
      throw new HttpsError('not-found', 'Invalid invite link');
    }

    const invite = inviteSnap.data()!;
    if (invite.used) {
      throw new HttpsError('failed-precondition', 'This invite link has already been used');
    }
    if (invite.expiresAt.toDate() < new Date()) {
      throw new HttpsError('deadline-exceeded', 'This invite link has expired');
    }

    const familyId = invite.familyId;

    // 2. Verify email code
    const codeDoc = await db
      .collection('verificationCodes')
      .doc(data.email.toLowerCase())
      .get();

    if (!codeDoc.exists) {
      throw new HttpsError('not-found', 'No verification code found');
    }

    const codeData = codeDoc.data()!;

    if (codeData.expiresAt.toDate() < new Date()) {
      throw new HttpsError('deadline-exceeded', 'Verification code expired');
    }

    if ((codeData.attempts || 0) >= 5) {
      throw new HttpsError('resource-exhausted', 'Too many failed attempts. Request a new code.');
    }

    if (codeData.code !== data.verificationCode) {
      await codeDoc.ref.update({ attempts: (codeData.attempts || 0) + 1 });
      throw new HttpsError('invalid-argument', 'Invalid verification code');
    }

    // 3. Verify family exists
    const familySnap = await db.collection('families').doc(familyId).get();
    if (!familySnap.exists) {
      throw new HttpsError('not-found', 'Family not found');
    }

    // 4. Create Firebase Auth user
    let uid: string;
    try {
      const userRecord = await adminAuth.createUser({
        email: data.email.toLowerCase(),
        password: data.password,
        displayName: `${data.firstName} ${data.lastName}`,
      });
      uid = userRecord.uid;
    } catch (err: any) {
      if (err.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'An account with this email already exists');
      }
      throw new HttpsError('internal', 'Failed to create account');
    }

    const now = new Date();

    // 5. Create parent user document
    await db.collection('users').doc(uid).set({
      uid,
      role: 'parent',
      email: data.email.toLowerCase(),
      status: 'active',
      firstName: data.firstName,
      lastName: data.lastName,
      language: 'en',
      familyId,
      notifPrefs: {
        newRequest: { push: true, email: true },
        confirmed: { push: true, email: true },
        cancelled: { push: true, email: true },
        reminders: { push: true, email: false },
      },
      fcmTokens: [],
      createdAt: now,
      updatedAt: now,
    });

    // 6. Add to family's parentIds
    await db.collection('families').doc(familyId).update({
      parentIds: FieldValue.arrayUnion(uid),
      updatedAt: now,
    });

    // 7. Mark invite as used
    await inviteSnap.ref.update({
      used: true,
      usedByUserId: uid,
    });

    // 8. Clean up verification code
    await codeDoc.ref.delete();

    await writeUserActivity(uid, 'joined_family', { familyId });

    return { success: true, uid, familyId };
  }
);
