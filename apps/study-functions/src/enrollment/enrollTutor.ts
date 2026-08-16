import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { strongPasswordSchema } from '@ejm/sit-core';
import { validateEjmEmail, checkEnrollmentAge } from '@ejm/shared-core';
import { db, adminAuth } from '@ejm/shared-functions/config/firebase.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import {
  addProfileToUser,
  assertCanAddProfile,
  ensureScheduleDoc,
} from '@ejm/shared-functions/enrollment/addProfileToUser.js';
import { tutorEnrollmentSchema, withPrefDefaults } from '../validation/tutor.js';
import type { TutorEnrollmentInput } from '../validation/tutor.js';

interface EnrollTutorData {
  ejemEmail: string;
  verificationCode: string;
  password?: string;
  consentVersion: string;
  enrollment: TutorEnrollmentInput;
}

/**
 * Normalize a stored users-doc dateOfBirth: a Firestore Timestamp on
 * study-created accounts, a "YYYY-MM-DD" string on sit-created ones.
 * Exported for unit tests — it decides which DOB the age gate runs against.
 */
export function toDobDate(dob: unknown): Date | null {
  if (typeof dob === 'string' && dob) return new Date(dob);
  if (dob && typeof (dob as { toDate?: unknown }).toDate === 'function') {
    return (dob as { toDate: () => Date }).toDate();
  }
  return null;
}

export const enrollTutor = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const data = request.data as EnrollTutorData;
    const isAddProfile = !!request.auth;

    // 1. Validate password (only for the new-account path)
    if (!isAddProfile) {
      const passwordResult = strongPasswordSchema.safeParse(data.password);
      if (!passwordResult.success) {
        throw new HttpsError(
          'invalid-argument',
          passwordResult.error.issues[0]?.message || 'Password does not meet requirements',
        );
      }
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
    // Pref fields the wizard no longer collects arrive absent; default them
    // once here so both the add-profile and new-account writes agree.
    const enrollment = withPrefDefaults(enrollmentResult.data);

    // Require at least one contact field
    if (!enrollment.contactEmail && !enrollment.contactPhone && !enrollment.whatsapp) {
      throw new HttpsError('invalid-argument', 'At least one contact field is required');
    }

    // 5. Build the tutor profile (shared by both the add-profile and the
    // new-account paths).
    const ejemEmailLower = data.ejemEmail.toLowerCase();
    const now = new Date();

    // 5-bis. Self-enrollment age gate (governance PR 1): dual-signal check of
    // the entered DOB against the graduation year embedded in the EJM email.
    // Runs on BOTH paths, before any account/profile write. In production the
    // email is always EJM-valid (verifyEjmEmail gates code issuance), so an
    // unparseable email (legacy fixtures) skips the check rather than adding a
    // new rejection here. The under-15 floor is never waivable; a mismatch is
    // waived only by an admin-managed enrollmentExemptions doc.
    //
    // GOVERNED bypass (governance PR 2): an account whose guardianLinks doc is
    // ACTIVE carries the server-owned governedBy mirror and a parent-attested
    // DOB — supervision, not gating, is its protection, so the whole gate
    // stands down. Only the add-profile path can be governed (a governed kid
    // always has an account); the new-account path keeps the full gate, and a
    // revoked link (mirror deleted) restores it.
    let isGoverned = false;
    let existingIdentity: Record<string, unknown> = {};
    if (isAddProfile) {
      const callerSnap = await db.collection('users').doc(request.auth!.uid).get();
      const callerData = callerSnap.data() ?? {};
      isGoverned = !!callerData.governedBy;
      existingIdentity = callerData;
    }

    // Identity coherence (issue #144): root identity is set-once. A new
    // account must supply all three fields; an add-profile caller may omit any
    // field the existing doc already holds (cross-app enrollment never
    // re-collects identity), but the merged result must be complete.
    const hasFirstName = !!enrollment.firstName || !!existingIdentity.firstName;
    const hasLastName = !!enrollment.lastName || !!existingIdentity.lastName;
    const hasDateOfBirth = !!enrollment.dateOfBirth || !!existingIdentity.dateOfBirth;
    if (!hasFirstName || !hasLastName || !hasDateOfBirth) {
      throw new HttpsError(
        'invalid-argument',
        'First name, last name and date of birth are required',
      );
    }

    // The age gate runs against the doc's DOB when one is on file (the
    // set-once, trusted value) and the payload DOB otherwise — the presence
    // check above guarantees at least one exists.
    const gateDob = toDobDate(existingIdentity.dateOfBirth)
      ?? new Date(enrollment.dateOfBirth!);
    const emailCheck = validateEjmEmail(data.ejemEmail);
    if (!isGoverned && emailCheck.valid && emailCheck.graduationYear !== undefined) {
      const verdict = checkEnrollmentAge({
        dateOfBirth: gateDob,
        graduationYear: emailCheck.graduationYear,
      });
      if (verdict === 'under_15') {
        throw new HttpsError(
          'failed-precondition',
          'You need to be at least 15 to enroll on your own. Your parents can create an account and enroll you from theirs.',
          { code: 'age/under-15' },
        );
      }
      if (verdict === 'age_mismatch') {
        const exemption = await db.collection('enrollmentExemptions').doc(ejemEmailLower).get();
        if (!exemption.exists) {
          throw new HttpsError(
            'failed-precondition',
            "Your date of birth doesn't match your school year. Please contact the EJM administrator.",
            { code: 'age/mismatch' },
          );
        }
      }
    }

    // Parse dateOfBirth string ("YYYY-MM-DD") into a Firestore Timestamp.
    // Absent on the add-profile path when the doc already holds a DOB —
    // fillBaseFields skips undefined values, so the stored one is kept.
    const dobTimestamp = enrollment.dateOfBirth
      ? Timestamp.fromDate(new Date(enrollment.dateOfBirth))
      : undefined;

    const tutorProfile = {
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
      areaLatLng: enrollment.areaLatLng ?? null,
      areaRadiusKm: enrollment.areaRadiusKm ?? null,
      languages: [],
      searchable: false,
      verification: { identityStatus: 'not_submitted' as const },
    };

    // 5a. Add-profile path — an authenticated existing user gains a tutor
    // profile. Base fields and consent on the existing doc are preserved.
    if (isAddProfile) {
      const uid = request.auth!.uid;
      // Preflight before the schedule write: a caller the profile merge would
      // reject (role-exclusive, profile-exists, blocked) must leave no orphan
      // schedules/{uid} doc behind. addProfileToUser re-checks in-transaction.
      await assertCanAddProfile(uid, 'tutor');
      // Idempotent, so it runs before the profile merge: if anything below
      // fails, no permanent state was created; once the merge commits, a
      // failed code-doc cleanup is harmless (retry hits profile-exists).
      await ensureScheduleDoc(uid);
      await addProfileToUser({
        uid,
        profileKey: 'tutor',
        profileData: tutorProfile,
        fillBaseFields: {
          firstName: enrollment.firstName,
          lastName: enrollment.lastName,
          dateOfBirth: dobTimestamp,
        },
        auditAction: 'tutor.profile_added',
        auditDetails: {
          ejemEmail: ejemEmailLower,
          consentVersion: data.consentVersion,
          subjects: enrollment.subjects.map((s) => s.subject),
        },
      });
      await codeDoc.ref.delete();
      return { uid };
    }

    // 5b. New-account path — create a Firebase Auth user.
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

    // 6a. Write the users/{uid} document — Plan D shape (profiles.tutor)
    // On the new-account path existingIdentity is empty, so the presence check
    // above guarantees the payload carries all three identity fields.
    await db.collection('users').doc(uid).set({
      uid,
      email: ejemEmailLower,
      firstName: enrollment.firstName!,
      lastName: enrollment.lastName!,
      dateOfBirth: dobTimestamp!,
      status: 'active',
      notifPrefs: {
        newRequest: { push: true, email: true },
        confirmed: { push: true, email: true },
        cancelled: { push: true, email: true },
        reminders: { push: true, email: false },
      },
      fcmTokens: [],
      profiles: {
        tutor: tutorProfile,
      },
      consentAt: now,
      consentVersion: data.consentVersion,
      createdAt: now,
      updatedAt: now,
    });

    // 6b. Write the schedules/{uid} document — empty weekly grid + empty overrides
    await ensureScheduleDoc(uid);

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
