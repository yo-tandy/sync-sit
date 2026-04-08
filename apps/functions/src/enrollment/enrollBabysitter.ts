import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { FieldValue } from 'firebase-admin/firestore';
import { strongPasswordSchema } from '@ejm/shared';
import { writeUserActivity } from '../admin/writeAuditLog.js';

interface EnrollBabysitterData {
  ejemEmail: string;
  verificationCode: string;
  password: string;
  consentVersion: string;
}

/**
 * Create a minimal babysitter account after email verification.
 * Only requires: email, verification code, password, and consent.
 * Profile fields are filled in subsequent client-side steps.
 */
export const enrollBabysitter = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const data = request.data as EnrollBabysitterData;

    // 0. Validate password
    const passwordResult = strongPasswordSchema.safeParse(data.password);
    if (!passwordResult.success) {
      throw new HttpsError('invalid-argument', passwordResult.error.issues[0]?.message || 'Password does not meet requirements');
    }

    if (!data.consentVersion) {
      throw new HttpsError('invalid-argument', 'Consent is required');
    }

    // 1. Verify the code
    const codeDoc = await db
      .collection('verificationCodes')
      .doc(data.ejemEmail.toLowerCase())
      .get();

    if (!codeDoc.exists) {
      throw new HttpsError('not-found', 'No verification code found. Please request a new one.');
    }

    const codeData = codeDoc.data()!;

    if (codeData.expiresAt.toDate() < new Date()) {
      throw new HttpsError('deadline-exceeded', 'Verification code has expired. Please request a new one.');
    }

    if ((codeData.attempts || 0) >= 5) {
      throw new HttpsError('resource-exhausted', 'Too many failed attempts. Please request a new verification code.');
    }

    if (codeData.code !== data.verificationCode) {
      await codeDoc.ref.update({ attempts: FieldValue.increment(1) });
      throw new HttpsError('invalid-argument', 'Invalid verification code');
    }

    // 2. Create Firebase Auth user
    let uid: string;
    try {
      const userRecord = await adminAuth.createUser({
        email: data.ejemEmail.toLowerCase(),
        password: data.password,
      });
      uid = userRecord.uid;
    } catch (err: any) {
      if (err.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'An account with this email already exists');
      }
      throw new HttpsError('internal', 'Failed to create account');
    }

    // 3. Create minimal Firestore user document
    const now = new Date();
    await db.collection('users').doc(uid).set({
      uid,
      role: 'babysitter',
      email: data.ejemEmail.toLowerCase(),
      ejemEmail: data.ejemEmail.toLowerCase(),
      status: 'active',
      enrollmentComplete: false,
      searchable: false,
      language: 'en',
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
      consentVersion: data.consentVersion,
    });

    // 4. Create empty schedule
    const emptySlots = new Array(96).fill(false);
    await db.collection('schedules').doc(uid).set({
      userId: uid,
      weekly: {
        mon: emptySlots,
        tue: emptySlots,
        wed: emptySlots,
        thu: emptySlots,
        fri: emptySlots,
        sat: emptySlots,
        sun: emptySlots,
      },
      holidayMode: 'same',
      updatedAt: now,
    });

    // 5. Clean up verification code
    await codeDoc.ref.delete();

    await writeUserActivity(uid, 'babysitter_enrolled', { email: data.ejemEmail });

    return { success: true, uid };
  }
);
