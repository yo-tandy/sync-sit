import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { familyEnrollmentSchema } from '@ejm/shared';
import { writeUserActivity } from '../admin/writeAuditLog.js';

interface KidInput {
  firstName: string;
  age: number;
  languages: string[];
}

interface EnrollFamilyData {
  email: string;
  verificationCode: string;
  password: string;
  familyName: string;
  lastName?: string; // if different from family name
  firstName: string;
  address: string;
  latLng: { lat: number; lng: number };
  pets?: string;
  note?: string;
  kids: KidInput[];
  searchDefaults?: {
    minBabysitterAge?: number;
    preferredGender?: string;
    requireReferences?: boolean;
    maxRate?: number;
  };
}

export const enrollFamily = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const data = request.data as EnrollFamilyData;

    // 0. Validate inputs
    const validationResult = familyEnrollmentSchema.safeParse(data);
    if (!validationResult.success) {
      throw new HttpsError('invalid-argument', validationResult.error.issues[0]?.message || 'Invalid data');
    }
    if (!data.password || data.password.length < 8) {
      throw new HttpsError('invalid-argument', 'Password must be at least 8 characters');
    }

    // 1. Verify the code (for parent email verification)
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

    // 2. Validate
    if (!data.familyName || !data.firstName || !data.address) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    // 3. Create Firebase Auth user
    let uid: string;
    try {
      const userRecord = await adminAuth.createUser({
        email: data.email.toLowerCase(),
        password: data.password,
        displayName: `${data.firstName} ${data.lastName || data.familyName}`,
      });
      uid = userRecord.uid;
    } catch (err: any) {
      if (err.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'An account with this email already exists');
      }
      throw new HttpsError('internal', 'Failed to create account');
    }

    const now = new Date();

    // 4. Create family document
    const familyRef = db.collection('families').doc();
    const familyId = familyRef.id;

    await familyRef.set({
      familyId,
      familyName: data.familyName,
      address: data.address,
      latLng: data.latLng,
      photoUrl: null,
      pets: data.pets || null,
      note: data.note || null,
      parentIds: [uid],
      searchDefaults: data.searchDefaults || null,
      createdAt: now,
      updatedAt: now,
      status: 'active',
    });

    // 5. Create kid documents (if provided during enrollment)
    if (data.kids?.length) {
      for (const kid of data.kids) {
        if (!kid.firstName) continue;
        const kidRef = familyRef.collection('kids').doc();
        await kidRef.set({
          kidId: kidRef.id,
          firstName: kid.firstName,
          age: kid.age,
          languages: kid.languages,
        });
      }
    }

    // 6. Create parent user document
    await db.collection('users').doc(uid).set({
      uid,
      role: 'parent',
      email: data.email.toLowerCase(),
      status: 'active',
      firstName: data.firstName,
      lastName: data.lastName || data.familyName,
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
      consentAt: now,
      consentVersion: '1.0',
    });

    // 7. Clean up verification code
    await codeDoc.ref.delete();

    await writeUserActivity(uid, 'family_enrolled', { email: data.email });

    return { success: true, uid, familyId };
  }
);
