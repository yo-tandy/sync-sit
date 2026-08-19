import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { strongPasswordSchema } from '@ejm/sit-core';
import { validateEjmEmail, checkEnrollmentAge, getEjemEmail, getContact, type User } from '@ejm/shared-core';
import { db, adminAuth } from '@ejm/shared-functions/config/firebase.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import {
  addProfileToUser,
  assertCanAddProfile,
  ensureScheduleDoc,
} from '@ejm/shared-functions/enrollment/addProfileToUser.js';
import { toDobDate } from './dob.js';
import { tutorEnrollmentSchema, withPrefDefaults } from '../validation/tutor.js';
import type { TutorEnrollmentInput } from '../validation/tutor.js';

interface EnrollTutorData {
  ejemEmail?: string;
  verificationCode?: string;
  password?: string;
  consentVersion: string;
  enrollment?: TutorEnrollmentInput;
  // Cross-app switch (issue #144, owner clarification): a signed-in sit
  // babysitter adds a tutor profile without re-proving mailbox ownership —
  // the EJM identity was verified at first enrollment and lives on the doc.
  // Only `subjects` (tutor-specific) is collected; classLevel/gender/contact
  // are copied server-side from the babysitter profile.
  crossApp?: boolean;
  subjects?: unknown;
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


export const enrollTutor = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const data = request.data as EnrollTutorData;
    const isAddProfile = !!request.auth;
    const isCrossApp = isAddProfile && data.crossApp === true;

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

    // The caller doc feeds three later checks (crossApp email derivation,
    // governance bypass, identity presence) — fetch it once, up front.
    let callerData: Record<string, unknown> = {};
    if (isAddProfile) {
      const callerSnap = await db.collection('users').doc(request.auth!.uid).get();
      callerData = callerSnap.data() ?? {};
    }

    // 3. Establish the verified EJM identity.
    // Cross-app: derive it from the caller's OTHER provider profile — a
    // signed-in babysitter re-proving mailbox ownership is redundant by design
    // (owner call on issue #144); the audit trail records crossApp: true. The
    // wizard sends only `subjects`; classLevel/gender/contact are copied from
    // the babysitter profile and validated through the same schema.
    // Classic: verify the emailed code as before.
    let ejemEmailLower: string;
    let codeDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    let enrollmentInput: unknown;
    if (isCrossApp) {
      const profiles = (callerData.profiles ?? {}) as Record<string, unknown>;
      const babysitterProfile = (profiles.babysitter ?? null) as Record<string, unknown> | null;
      // The EJM identity is canonical at the ROOT with a nested fallback
      // (issue #203 shared identity) — but crossApp still requires the OTHER
      // provider profile to exist: that profile is what proves the identity
      // was verified by a real enrollment.
      const derivedEjemEmail = getEjemEmail(callerData as unknown as User);
      if (!babysitterProfile || !derivedEjemEmail) {
        throw new HttpsError('failed-precondition', 'No verified EJM identity on this account');
      }
      ejemEmailLower = derivedEjemEmail.toLowerCase();
      // classLevel/gender stay profile-scoped; contact resolves root ?? nested
      // so a babysitter who edited contact at the canonical root still hands
      // the fresh values to their new tutor profile.
      enrollmentInput = {
        subjects: data.subjects,
        ...copySharedProfileFields(babysitterProfile),
        ...Object.fromEntries(
          Object.entries(getContact(callerData as unknown as User)).filter(([, v]) => v !== null),
        ),
      };
    } else {
      if (!data.ejemEmail) {
        throw new HttpsError('invalid-argument', 'EJM email is required');
      }
      ejemEmailLower = data.ejemEmail.toLowerCase();
      enrollmentInput = data.enrollment;
      codeDoc = await db.collection('verificationCodes').doc(ejemEmailLower).get();

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
    }

    // 4. Validate enrollment payload (crossApp: the synthesized input — the
    // subjects floor and every copied-field bound apply identically)
    const enrollmentResult = tutorEnrollmentSchema.safeParse(enrollmentInput);
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
    const isGoverned = !!callerData.governedBy;
    const existingIdentity: Record<string, unknown> = callerData;

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
    // A malformed stored DOB would make gateDob an Invalid Date, and
    // checkEnrollmentAge quietly returns 'ok' for a NaN age — never let a
    // security gate no-op silently.
    if (Number.isNaN(gateDob.getTime())) {
      throw new HttpsError('invalid-argument', 'Date of birth is invalid');
    }
    const emailCheck = validateEjmEmail(ejemEmailLower);
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
      // Tutors share the babysitter trust model (owner decision 2026-08-17):
      // the EJM-email verification-code gate is the only identity check, so
      // enrollment is complete at creation. Search eligibility is then owned
      // by the tutor's own searchable toggle; the dashboard only offers the
      // toggle once subjects and availability exist (UX gate, not a rule).
      enrollmentComplete: true,
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
        // Root shared-identity fields (issue #203): dual-write the canonical
        // root copies alongside the nested profile. fillBaseFields writes only
        // EMPTY root fields, so an existing canonical value always wins.
        fillBaseFields: {
          firstName: enrollment.firstName,
          lastName: enrollment.lastName,
          dateOfBirth: dobTimestamp,
          ejemEmail: ejemEmailLower,
          contactEmail: enrollment.contactEmail ?? undefined,
          contactPhone: enrollment.contactPhone ?? undefined,
          whatsapp: enrollment.whatsapp ?? undefined,
        },
        auditAction: 'tutor.profile_added',
        auditDetails: {
          ejemEmail: ejemEmailLower,
          consentVersion: data.consentVersion,
          subjects: enrollment.subjects.map((s) => s.subject),
          ...(isCrossApp ? { crossApp: true } : {}),
        },
      });
      if (codeDoc) await codeDoc.ref.delete();
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
        // Race backstop only: reaching here requires a valid emailed code, so
        // this is not an enumeration oracle (the caller owns the mailbox). No
        // machine-readable reason — clients surface the message as-is.
        throw new HttpsError('already-exists', 'An account with this email already exists');
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
      // Canonical root shared-identity copies (issue #203); the nested tutor
      // profile keeps its duplicates for back-compat readers.
      ejemEmail: ejemEmailLower,
      contactEmail: enrollment.contactEmail ?? null,
      contactPhone: enrollment.contactPhone ?? null,
      whatsapp: enrollment.whatsapp ?? null,
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

    // 6d. Delete the consumed verification code (always present on the
    // new-account path)
    if (codeDoc) await codeDoc.ref.delete();

    return { uid };
  },
);
