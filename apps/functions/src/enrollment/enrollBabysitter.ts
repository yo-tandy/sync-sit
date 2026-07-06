import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { FieldValue } from 'firebase-admin/firestore';
import { strongPasswordSchema } from '@ejm/sit-core';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import {
  addProfileToUser,
  ensureScheduleDoc,
} from '@ejm/shared-functions/enrollment/addProfileToUser.js';

interface EnrollBabysitterData {
  ejemEmail: string;
  verificationCode: string;
  password?: string;
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
    const isAddProfile = !!request.auth;

    // 0. Validate password (only for the new-account path)
    if (!isAddProfile) {
      const passwordResult = strongPasswordSchema.safeParse(data.password);
      if (!passwordResult.success) {
        throw new HttpsError('invalid-argument', passwordResult.error.issues[0]?.message || 'Password does not meet requirements');
      }
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

    // 1a. Add-profile path — an authenticated existing user gains a babysitter
    // profile. Base fields and consent on the existing doc are preserved.
    if (isAddProfile) {
      const uid = request.auth!.uid;
      const ejemEmailLower = data.ejemEmail.toLowerCase();
      // Idempotent, so it runs before the profile merge: if anything below
      // fails, no permanent state was created; once the merge commits, a
      // failed code-doc cleanup is harmless (retry hits profile-exists).
      await ensureScheduleDoc(uid);
      await addProfileToUser({
        uid,
        profileKey: 'babysitter',
        profileData: {
          enrollmentComplete: false,
          ejemEmail: ejemEmailLower,
          searchable: false,
        },
        fillBaseFields: { language: 'en' },
        auditAction: 'babysitter_profile_added',
        auditDetails: { ejemEmail: ejemEmailLower, consentVersion: data.consentVersion },
      });
      await codeDoc.ref.delete();
      return { success: true, uid };
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
        throw new HttpsError('already-exists', 'An account with this email already exists', {
          reason: 'account-exists',
        });
      }
      throw new HttpsError('internal', 'Failed to create account');
    }

    // 3. Create minimal Firestore user document
    const now = new Date();
    await db.collection('users').doc(uid).set({
      uid,
      email: data.ejemEmail.toLowerCase(),
      status: 'active',
      profiles: {
        babysitter: {
          enrollmentComplete: false,
          ejemEmail: data.ejemEmail.toLowerCase(),
          searchable: false,
        },
      },
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
    await ensureScheduleDoc(uid);

    // 5. Clean up verification code
    await codeDoc.ref.delete();

    await writeUserActivity(uid, 'babysitter_enrolled', { email: data.ejemEmail });

    return { success: true, uid };
  }
);
