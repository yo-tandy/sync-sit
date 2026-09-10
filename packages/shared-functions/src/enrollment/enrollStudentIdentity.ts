import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  DEFAULT_NOTIF_PREFS,
  validateEjmEmail,
  checkEnrollmentAge,
  studentIdentityEnrollmentSchema,
} from '@ejm/shared-core';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { assertCodeIdentityClass } from '../auth/verificationCodeClass.js';

/**
 * Create a root-only identity: a Firebase Auth user plus a `users/{uid}` doc
 * carrying every field the unified enrollment flow's identity steps collect
 * (name/DOB/classLevel/gender/contact/bio/address), but NO role profile at
 * all (`profiles: {}`) — issue #435 milestone, PR4.
 *
 * Why a new callable rather than reusing enrollBabysitter/enrollTutor: both
 * existing new-account paths write `profiles.{babysitter,tutor}` as part of
 * account creation — there is no way to get "authenticated identity, no
 * role yet" out of either without inventing a role-less-payload mode on a
 * callable whose entire contract is "create this ONE role's account". The
 * unified flow needs exactly that shape BEFORE the sit/study choice (the
 * cross-origin handoff to study transfers a SESSION, not in-progress form
 * state — see the milestone plan's "Current state" section) — so the
 * sit/study choice screen calls enrollBabysitter/enrollTutor afterwards,
 * each in `crossApp: true` mode, to add the role the user picked.
 *
 * Verification mirrors enrollBabysitter's/enrollTutor's classic (non-
 * crossApp) branch exactly: an EJM-class verificationCodes/{email} doc,
 * consumed the same way. The age gate mirrors enrollTutor's self-enrollment
 * check (dual signal: DOB vs. the graduation year in the email).
 *
 * Idempotent against a double submit: `adminAuth.createUser` on a
 * previously-consumed email throws `auth/email-already-exists`, which maps
 * to the same `already-exists` HttpsError enrollBabysitter/enrollTutor use —
 * a retried submit never creates a second account or silently no-ops into a
 * mismatched state.
 */
export const enrollStudentIdentity = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const parsed = studentIdentityEnrollmentSchema.safeParse(request.data);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      throw new HttpsError('invalid-argument', firstIssue?.message || 'Invalid enrollment data');
    }
    const data = parsed.data;

    // Require at least one contact channel (matches enrollTutor's rule,
    // and StepContactInfo's own client-side gate) — the zod schema leaves
    // both individually optional so this check produces the clearer error.
    if (!data.contactEmail && !data.contactPhone && !data.whatsapp) {
      throw new HttpsError('invalid-argument', 'At least one contact field is required');
    }

    const ejemEmailLower = data.ejemEmail.toLowerCase();

    // 1. Consume the emailed verification code — identical to
    // enrollBabysitter's/enrollTutor's classic new-account branch.
    const codeDoc = await db.collection('verificationCodes').doc(ejemEmailLower).get();
    if (!codeDoc.exists) {
      throw new HttpsError('not-found', 'No verification code found. Please request a new one.');
    }
    const codeData = codeDoc.data()!;

    // Student enrollment is an EJM-member activity — require an EJM-class
    // code, not merely "a code exists" (mirrors enrollBabysitter/enrollTutor,
    // issue #322).
    assertCodeIdentityClass(codeData, 'ejm');

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

    // 2. Self-enrollment age gate (governance design), dual signal: entered
    // DOB against the graduation year embedded in the EJM email — same rule
    // enrollTutor applies. No governed-user bypass here: a governed kid's
    // account is created by their parent through a different path
    // entirely, never this self-service one.
    const dob = new Date(data.dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      throw new HttpsError('invalid-argument', 'Date of birth is invalid');
    }
    const emailCheck = validateEjmEmail(ejemEmailLower);
    if (emailCheck.valid && emailCheck.graduationYear !== undefined) {
      const verdict = checkEnrollmentAge({ dateOfBirth: dob, graduationYear: emailCheck.graduationYear });
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

    // 3. Create the Firebase Auth user. A retried submit (double-click, or
    // a client retry after a transport blip on the FIRST attempt's response)
    // hits `auth/email-already-exists` here and fails cleanly — no second
    // account, no partial doc.
    let uid: string;
    try {
      const userRecord = await adminAuth.createUser({ email: ejemEmailLower, password: data.password });
      uid = userRecord.uid;
    } catch (err: unknown) {
      const fbErr = err as { code?: string };
      if (fbErr.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'An account with this email already exists');
      }
      throw new HttpsError('internal', 'Failed to create account');
    }

    // 4. Create the root-only users/{uid} doc — no role profile at all.
    const now = new Date();
    await db.collection('users').doc(uid).set({
      uid,
      email: ejemEmailLower,
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: Timestamp.fromDate(dob),
      ejemEmail: ejemEmailLower,
      classLevel: data.classLevel,
      gender: data.gender,
      // Channels the user never supplied are OMITTED, not written as null:
      // root presence means "the user set or cleared this" (see getContact's
      // doc comment) — an enrollment-time omission must not read as a
      // deliberate clear on a doc that never had a chance to hold one.
      ...(data.contactEmail ? { contactEmail: data.contactEmail } : {}),
      ...(data.contactPhone ? { contactPhone: data.contactPhone } : {}),
      ...(data.whatsapp ? { whatsapp: data.whatsapp } : {}),
      ...(data.bio ? { bio: data.bio } : {}),
      ...(data.address !== undefined ? { address: data.address } : {}),
      // Recorded unconditionally (even `false`), unlike the optional fields
      // above: this is a yes/no answer the user gave, not an unanswered
      // question — enrollBabysitter's/enrollTutor's crossApp mode reads it
      // back verbatim to seed the new profile's `searchable`.
      contactVisibilityConsent: data.contactVisibilityConsent === true,
      status: 'active',
      language: data.language ?? 'en',
      notifPrefs: DEFAULT_NOTIF_PREFS,
      fcmTokens: [],
      profiles: {},
      createdAt: now,
      updatedAt: now,
      consentAt: now,
      consentVersion: data.consentVersion,
    });

    await codeDoc.ref.delete();
    await writeUserActivity(uid, 'student_identity_enrolled', { email: ejemEmailLower });

    return { success: true, uid };
  },
);
