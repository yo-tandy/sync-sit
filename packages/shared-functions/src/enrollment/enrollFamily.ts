import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { familyEnrollmentSchema } from '@ejm/sit-core';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { addProfileToUser, assertCanAddProfile } from './addProfileToUser.js';

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
  postcode?: string;
  city?: string;
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
    const isAddProfile = !!request.auth;

    // 0. Validate inputs
    const validationResult = familyEnrollmentSchema.safeParse(data);
    if (!validationResult.success) {
      throw new HttpsError('invalid-argument', validationResult.error.issues[0]?.message || 'Invalid data');
    }
    if (!isAddProfile && (!data.password || data.password.length < 8)) {
      throw new HttpsError('invalid-argument', 'Password must be at least 8 characters');
    }

    // 1. Verify the code (for parent email verification) — new-account path only
    let codeRef: FirebaseFirestore.DocumentReference | null = null;
    if (!isAddProfile) {
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

      codeRef = codeDoc.ref;
    }

    // 2. Validate
    if (!data.familyName || !data.firstName || !data.address) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    // 3. Resolve the uid — either the authed caller (add-profile) or a new
    // Firebase Auth user (new-account path).
    let uid: string;
    if (isAddProfile) {
      uid = request.auth!.uid;
      // Preflight so a doomed merge doesn't leave an orphan family doc.
      await assertCanAddProfile(uid, 'parent');
    } else {
      try {
        const userRecord = await adminAuth.createUser({
          email: data.email.toLowerCase(),
          password: data.password,
          displayName: `${data.firstName} ${data.lastName || data.familyName}`,
        });
        uid = userRecord.uid;
      } catch (err: unknown) {
        const fbErr = err as { code?: string };
        if (fbErr.code === 'auth/email-already-exists') {
          // Race backstop only: reaching here requires a valid emailed code,
          // so this is not an enumeration oracle (the caller owns the
          // mailbox). No machine-readable reason — clients surface the
          // message as-is.
          throw new HttpsError('already-exists', 'An account with this email already exists');
        }
        throw new HttpsError('internal', 'Failed to create account');
      }
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
      // Coverage-area matching inputs (issue #167) — null when the client
      // sent none (legacy clients, hand-typed addresses).
      postcode: data.postcode || null,
      city: data.city || null,
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

    // 6. Create / merge the parent user document
    if (isAddProfile) {
      await addProfileToUser({
        uid,
        profileKey: 'parent',
        profileData: { enrollmentComplete: true, familyId },
        fillBaseFields: {
          firstName: data.firstName,
          lastName: data.lastName || data.familyName,
          language: 'en',
        },
        auditAction: 'family_profile_added',
        auditDetails: { familyId },
      });
    } else {
      await db.collection('users').doc(uid).set({
        uid,
        email: data.email.toLowerCase(),
        status: 'active',
        firstName: data.firstName,
        lastName: data.lastName || data.familyName,
        language: 'en',
        profiles: {
          parent: {
            enrollmentComplete: true,
            familyId,
          },
        },
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

      // 7. Clean up verification code and audit (new-account path only; the
      // add-profile path audits via addProfileToUser with 'family_profile_added').
      if (codeRef) await codeRef.delete();
      await writeUserActivity(uid, 'family_enrolled', { email: data.email });
    }

    return { success: true, uid, familyId };
  }
);
