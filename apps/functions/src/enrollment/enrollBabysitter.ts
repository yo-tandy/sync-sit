import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { FieldValue } from 'firebase-admin/firestore';
import { isOldEnough, babysitterProfileSchema, babysitterPreferencesSchema } from '@ejm/shared';

interface EnrollBabysitterData {
  ejemEmail: string;
  verificationCode: string;
  password: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO string
  gender?: string;
  classLevel: string;
  languages: string[];
  kidAgeMin: number;
  kidAgeMax: number;
  maxKids: number;
  hourlyRate: number;
  aboutMe?: string;
  contactEmail?: string;
  contactPhone?: string;
  areaMode: 'arrondissement' | 'distance';
  arrondissements?: string[];
  areaAddress?: string;
  areaLatLng?: { lat: number; lng: number };
  areaRadiusKm?: number;
}

export const enrollBabysitter = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const data = request.data as EnrollBabysitterData;

    // 0. Validate inputs
    const profileResult = babysitterProfileSchema.safeParse(data);
    if (!profileResult.success) {
      throw new HttpsError('invalid-argument', profileResult.error.issues[0]?.message || 'Invalid profile data');
    }
    const prefsResult = babysitterPreferencesSchema.safeParse(data);
    if (!prefsResult.success) {
      throw new HttpsError('invalid-argument', prefsResult.error.issues[0]?.message || 'Invalid preferences data');
    }
    if (!data.password || data.password.length < 8) {
      throw new HttpsError('invalid-argument', 'Password must be at least 8 characters');
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

    // 2. Validate age
    const dob = new Date(data.dateOfBirth);
    if (!isOldEnough(dob)) {
      throw new HttpsError('invalid-argument', 'You must be at least 15 years old');
    }

    // 3. Validate contact info
    if (!data.contactEmail && !data.contactPhone) {
      throw new HttpsError('invalid-argument', 'Provide at least one contact method');
    }

    // 4. Create Firebase Auth user
    let uid: string;
    try {
      const userRecord = await adminAuth.createUser({
        email: data.ejemEmail.toLowerCase(),
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

    // 5. Create Firestore user document
    const now = new Date();
    await db.collection('users').doc(uid).set({
      uid,
      role: 'babysitter',
      email: data.ejemEmail.toLowerCase(),
      ejemEmail: data.ejemEmail.toLowerCase(),
      status: 'active',
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth, // Store as "yyyy-MM-dd" string
      gender: data.gender || null,
      classLevel: data.classLevel,
      photoUrl: null,
      searchable: false,
      languages: data.languages,
      aboutMe: data.aboutMe || null,
      language: 'en', // Will be updated by client
      kidAgeRange: { min: data.kidAgeMin, max: data.kidAgeMax },
      maxKids: data.maxKids,
      hourlyRate: data.hourlyRate,
      contactEmail: data.contactEmail || null,
      contactPhone: data.contactPhone || null,
      areaMode: data.areaMode,
      arrondissements: data.arrondissements || null,
      areaAddress: data.areaAddress || null,
      areaLatLng: data.areaLatLng || null,
      areaRadiusKm: data.areaRadiusKm || null,
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

    // 6. Create empty schedule
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

    // 7. Clean up verification code
    await codeDoc.ref.delete();

    return { success: true, uid };
  }
);
