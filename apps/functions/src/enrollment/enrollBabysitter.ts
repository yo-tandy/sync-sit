import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { FieldValue } from 'firebase-admin/firestore';
import { strongPasswordSchema } from '@ejm/sit-core';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import {
  addProfileToUser,
  assertCanAddProfile,
  ensureScheduleDoc,
} from '@ejm/shared-functions/enrollment/addProfileToUser.js';

interface EnrollBabysitterData {
  ejemEmail?: string;
  verificationCode?: string;
  password?: string;
  consentVersion: string;
  // Cross-app switch (issue #144, owner clarification): a signed-in study
  // tutor adds a babysitter profile without re-proving mailbox ownership —
  // the EJM identity was verified at first enrollment and lives on the doc.
  crossApp?: boolean;
}

/** Copy the profile-scoped fields both provider profile types share — only
 *  those actually present on the source profile. */
function copySharedProfileFields(source: Record<string, unknown>): Record<string, unknown> {
  const copied: Record<string, unknown> = {};
  for (const key of ['classLevel', 'gender', 'contactEmail', 'contactPhone', 'whatsapp']) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      copied[key] = source[key];
    }
  }
  return copied;
}

/**
 * Create a minimal babysitter account after email verification.
 * Only requires: email, verification code, password, and consent.
 * Profile fields are filled in subsequent client-side steps.
 * Cross-app mode (authed callers only): no code — the EJM email is derived
 * from the caller's verified tutor profile.
 */
export const enrollBabysitter = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const data = request.data as EnrollBabysitterData;
    const isAddProfile = !!request.auth;
    const isCrossApp = isAddProfile && data.crossApp === true;

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

    // 1. Establish the verified EJM identity.
    // Cross-app: derive it from the caller's OTHER provider profile — a
    // signed-in tutor re-proving mailbox ownership is redundant by design
    // (owner call on issue #144); the audit trail records crossApp: true.
    // Classic: verify the emailed code as before.
    let ejemEmailLower: string;
    let codeDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    let copiedProfileFields: Record<string, unknown> = {};
    if (isCrossApp) {
      const callerSnap = await db.collection('users').doc(request.auth!.uid).get();
      const tutorProfile = (callerSnap.data()?.profiles?.tutor ?? null) as Record<string, unknown> | null;
      if (!tutorProfile || typeof tutorProfile.ejemEmail !== 'string' || !tutorProfile.ejemEmail) {
        throw new HttpsError('failed-precondition', 'No verified EJM identity on this account');
      }
      ejemEmailLower = tutorProfile.ejemEmail.toLowerCase();
      copiedProfileFields = copySharedProfileFields(tutorProfile);
    } else {
      if (!data.ejemEmail) {
        throw new HttpsError('invalid-argument', 'EJM email is required');
      }
      ejemEmailLower = data.ejemEmail.toLowerCase();
      codeDoc = await db.collection('verificationCodes').doc(ejemEmailLower).get();

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
    }

    // 1a. Add-profile path — an authenticated existing user gains a babysitter
    // profile. Base fields and consent on the existing doc are preserved.
    if (isAddProfile) {
      const uid = request.auth!.uid;
      // Preflight before the schedule write: a caller the profile merge would
      // reject (role-exclusive, profile-exists, blocked) must leave no orphan
      // schedules/{uid} doc behind. addProfileToUser re-checks in-transaction.
      await assertCanAddProfile(uid, 'babysitter');
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
          // Cross-app: seed the fields the tutor profile already answered
          // (classLevel/gender/contact) so the wizard only asks for what is
          // sit-specific (availability).
          ...copiedProfileFields,
        },
        fillBaseFields: { language: 'en' },
        auditAction: 'babysitter_profile_added',
        auditDetails: {
          ejemEmail: ejemEmailLower,
          consentVersion: data.consentVersion,
          ...(isCrossApp ? { crossApp: true } : {}),
        },
      });
      if (codeDoc) await codeDoc.ref.delete();
      return { success: true, uid };
    }

    // 2. Create Firebase Auth user
    let uid: string;
    try {
      const userRecord = await adminAuth.createUser({
        email: ejemEmailLower,
        password: data.password,
      });
      uid = userRecord.uid;
    } catch (err: unknown) {
      const fbErr = err as { code?: string };
      if (fbErr.code === 'auth/email-already-exists') {
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
      email: ejemEmailLower,
      status: 'active',
      profiles: {
        babysitter: {
          enrollmentComplete: false,
          ejemEmail: ejemEmailLower,
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

    // 5. Clean up verification code (always present on the new-account path)
    if (codeDoc) await codeDoc.ref.delete();

    await writeUserActivity(uid, 'babysitter_enrolled', { email: ejemEmailLower });

    return { success: true, uid };
  }
);
