import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { strongPasswordSchema } from '@ejm/sit-core';
import { db, adminAuth } from '@ejm/shared-functions/config/firebase.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { tutorEnrollmentSchema } from '../validation/tutor.js';
import type { TutorEnrollmentInput } from '../validation/tutor.js';

// TODO: Cross-app enrollment (existing sync-sit user becoming a tutor) is deferred.
// When implemented, detect an existing uid for the ejemEmail and branch into an
// "add study profile" path rather than creating a new Auth user and user doc.

interface EnrollTutorData {
  ejemEmail: string;
  verificationCode: string;
  password: string;
  consentVersion: string;
  enrollment: TutorEnrollmentInput;
}

export const enrollTutor = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const data = request.data as EnrollTutorData;

    // 1. Validate password
    const passwordResult = strongPasswordSchema.safeParse(data.password);
    if (!passwordResult.success) {
      throw new HttpsError(
        'invalid-argument',
        passwordResult.error.issues[0]?.message || 'Password does not meet requirements',
      );
    }

    // 2. Require consent
    if (!data.consentVersion) {
      throw new HttpsError('invalid-argument', 'Consent is required');
    }

    // 3. Verify the code
    const codeDoc = await db
      .collection('verificationCodes')
      .doc(data.ejemEmail.toLowerCase())
      .get();

    if (!codeDoc.exists) {
      throw new HttpsError('not-found', 'No verification code found. Please request a new one.');
    }

    const codeData = codeDoc.data()!;

    if (codeData.expiresAt.toDate() < new Date()) {
      throw new HttpsError(
        'deadline-exceeded',
        'Verification code has expired. Please request a new one.',
      );
    }

    if ((codeData.attempts || 0) >= 5) {
      throw new HttpsError(
        'resource-exhausted',
        'Too many failed attempts. Please request a new verification code.',
      );
    }

    if (codeData.code !== data.verificationCode) {
      await codeDoc.ref.update({ attempts: FieldValue.increment(1) });
      throw new HttpsError('invalid-argument', 'Invalid verification code');
    }

    // 4. Validate enrollment payload
    const enrollmentResult = tutorEnrollmentSchema.safeParse(data.enrollment);
    if (!enrollmentResult.success) {
      const firstIssue = enrollmentResult.error.issues[0];
      throw new HttpsError(
        'invalid-argument',
        firstIssue?.message || 'Invalid enrollment data',
      );
    }
    const enrollment = enrollmentResult.data;

    // Require at least one contact field
    if (!enrollment.contactEmail && !enrollment.contactPhone && !enrollment.whatsapp) {
      throw new HttpsError('invalid-argument', 'At least one contact field is required');
    }

    // 5. Create Firebase Auth user
    const ejemEmailLower = data.ejemEmail.toLowerCase();
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
        throw new HttpsError('already-exists', 'An account with this email already exists');
      }
      throw new HttpsError('internal', 'Failed to create account');
    }

    const now = new Date();

    // Parse dateOfBirth string ("YYYY-MM-DD") into a Firestore Timestamp
    const dobTimestamp = Timestamp.fromDate(new Date(enrollment.dateOfBirth));

    // 6a. Write the users/{uid} document — Plan D shape (profiles.tutor)
    await db.collection('users').doc(uid).set({
      uid,
      email: ejemEmailLower,
      firstName: enrollment.firstName,
      lastName: enrollment.lastName,
      dateOfBirth: dobTimestamp,
      status: 'active',
      notifPrefs: {
        newRequest: { push: true, email: true },
        confirmed: { push: true, email: true },
        cancelled: { push: true, email: true },
        reminders: { push: true, email: false },
      },
      fcmTokens: [],
      profiles: {
        tutor: {
          enrollmentComplete: false, // false until admin verification completes
          ejemEmail: ejemEmailLower,
          classLevel: enrollment.classLevel,
          gender: enrollment.gender ?? null,
          subjects: enrollment.subjects,
          sessionLengthsMin: enrollment.sessionLengthsMin,
          locationPrefs: enrollment.locationPrefs,
          paddingMin: enrollment.paddingMin,
          aboutMe: enrollment.aboutMe ?? null,
          contactEmail: enrollment.contactEmail ?? null,
          contactPhone: enrollment.contactPhone ?? null,
          whatsapp: enrollment.whatsapp ?? null,
          areaMode: enrollment.areaMode,
          arrondissements: enrollment.arrondissements ?? [],
          areaAddress: enrollment.areaAddress ?? null,
          areaRadiusKm: enrollment.areaRadiusKm ?? null,
          languages: [],
          searchable: true,
        },
      },
      consentAt: now,
      consentVersion: data.consentVersion,
      createdAt: now,
      updatedAt: now,
    });

    // 6b. Write the schedules/{uid} document — empty weekly grid + empty overrides
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
      overrides: {},
      holidayMode: 'same',
      updatedAt: now,
    });

    // 6c. Audit log
    await writeUserActivity(uid, 'tutor.enroll', {
      uid,
      ejemEmail: ejemEmailLower,
      subjects: enrollment.subjects.map((s) => s.subject),
    });

    // 6d. Delete the consumed verification code
    await codeDoc.ref.delete();

    return { uid };
  },
);
