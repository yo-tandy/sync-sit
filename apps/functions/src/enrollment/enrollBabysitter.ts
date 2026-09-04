import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { FieldValue } from 'firebase-admin/firestore';
import { strongPasswordSchema } from '@ejm/sit-core';
import { DEFAULT_NOTIF_PREFS, getEjemEmail, getContact, getClassLevel, getGender, type User } from '@ejm/shared-core';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { assertCodeIdentityClass } from '@ejm/shared-functions/auth/verificationCodeClass.js';
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
    // classLevel/gender resolved off the CALLER's existing doc for a lazy
    // root promotion (issue #435 milestone, PR1) — see the comment below.
    // Empty on the classic (non-crossApp) path: a brand-new babysitter has
    // no prior doc to resolve these from.
    let rootStudentFields: Record<string, unknown> = {};
    if (isCrossApp) {
      const callerSnap = await db.collection('users').doc(request.auth!.uid).get();
      const callerData = (callerSnap.data() ?? {}) as unknown as User;
      const tutorProfile = (callerSnap.data()?.profiles?.tutor ?? null) as Record<string, unknown> | null;
      // The EJM identity is canonical at the ROOT with a nested fallback
      // (issue #203 shared identity) — but crossApp still requires the OTHER
      // provider profile to exist: that profile is what proves the identity
      // was verified by a real enrollment.
      const derivedEjemEmail = getEjemEmail(callerData);
      if (!tutorProfile || !derivedEjemEmail) {
        throw new HttpsError('failed-precondition', 'No verified EJM identity on this account');
      }
      ejemEmailLower = derivedEjemEmail.toLowerCase();
      // classLevel/gender are canonical at ROOT now (issue #435 milestone,
      // PR1) — no copy step is needed here at all: getClassLevel/getGender
      // already resolve root ?? babysitter ?? tutor, so whichever app the
      // caller enrolled in first, the value is either already on the caller's
      // root doc (nothing to do below), or only ever lived on the caller's
      // OWN nested tutor profile (a legacy, not-yet-backfilled doc) — in
      // which case fillBaseFields below lazily promotes it to root. There is
      // no "copy classLevel/gender from the tutor profile into the babysitter
      // profile" step anymore; that would just recreate the duplication this
      // milestone removes.
      // Contact comes from the canonical resolution, which already falls
      // back to the nested copies when the root was never written. Its nulls
      // are applied UNFILTERED: post-clear semantics mean a null is an
      // explicit user deletion, and filtering it out would let the frozen
      // nested copy re-enter the doc and become canonical again (PR #206
      // review round 4).
      const canonical = getContact(callerData);
      copiedProfileFields = {
        contactEmail: canonical.contactEmail ?? null,
        contactPhone: canonical.contactPhone ?? null,
        whatsapp: canonical.whatsapp ?? null,
      };
      const resolvedClassLevel = getClassLevel(callerData);
      const resolvedGender = getGender(callerData);
      rootStudentFields = {
        ...(resolvedClassLevel !== undefined ? { classLevel: resolvedClassLevel } : {}),
        ...(resolvedGender !== undefined ? { gender: resolvedGender } : {}),
      };
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

      // Babysitting is an EJM-member activity, so this path requires an EJM
      // identity — NOT merely "a code exists" (issue #322). The any-domain
      // `verifyParentEmail` writes the same verificationCodes/{email}
      // namespace this line reads, so without the class assertion anyone with
      // any mailbox could mint a code there and enroll as a babysitter.
      // Transitional: a doc written before #322 carries no stamp and reads as
      // the weakest class, so it lands here — an enrollment in flight across
      // the deploy must request a new code (codes live 10 minutes; the
      // fallback can go once one code lifetime has passed post-deploy).
      // Placed before the expiry/attempts/comparison checks: the refusal is
      // about what the doc IS, so it must not burn a brute-force attempt.
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
          // Cross-app: seed the contact channels the tutor profile already
          // answered so the wizard only asks for what is sit-specific
          // (availability). classLevel/gender are NOT seeded here anymore
          // (issue #435 milestone, PR1) — they are root-only fields now; see
          // fillBaseFields below.
          ...copiedProfileFields,
        },
        // Root shared-identity fields (issue #203) plus classLevel/gender
        // (issue #435 milestone, PR1): dual-write the canonical root copies
        // alongside the nested ones. fillBaseFields writes only EMPTY root
        // fields, so an existing canonical value always wins. Channels/fields
        // with nothing to copy are OMITTED, never written as null: root
        // presence means "the user set or cleared this", so a null here
        // would read as a deliberate clear and block both the nested
        // fallback and the backfill (same fix as enrollTutor's new-account
        // write; PR #206 review round 7). The nested profile copy above
        // keeps its null convention. rootStudentFields resolves
        // getClassLevel/getGender off the CALLER's existing doc, so a
        // legacy caller whose classLevel/gender only ever lived on their
        // nested tutor profile gets it lazily promoted to root right here —
        // no separate backfill run required for THIS caller.
        fillBaseFields: {
          language: 'en',
          ejemEmail: ejemEmailLower,
          ...rootStudentFields,
        },
        // Contact is the CANONICAL resolution for this user (root ?? nested),
        // so writing it back is idempotent when the root already holds it and
        // corrective when only a nested copy did. Empty channels are omitted:
        // root presence means "set or cleared by the user" (PR #206 review).
        setBaseFields: {
          ...(copiedProfileFields.contactEmail ? { contactEmail: copiedProfileFields.contactEmail } : {}),
          ...(copiedProfileFields.contactPhone ? { contactPhone: copiedProfileFields.contactPhone } : {}),
          ...(copiedProfileFields.whatsapp ? { whatsapp: copiedProfileFields.whatsapp } : {}),
        },
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
        // Race backstop only: reaching here requires a valid emailed code, so
        // this is not an enumeration oracle (the caller owns the mailbox). No
        // machine-readable reason — clients surface the message as-is.
        throw new HttpsError('already-exists', 'An account with this email already exists');
      }
      throw new HttpsError('internal', 'Failed to create account');
    }

    // 3. Create minimal Firestore user document
    const now = new Date();
    await db.collection('users').doc(uid).set({
      uid,
      email: ejemEmailLower,
      // Canonical root copy (issue #203 shared identity); the nested copy
      // below stays for back-compat readers until the later cleanup.
      ejemEmail: ejemEmailLower,
      status: 'active',
      profiles: {
        babysitter: {
          enrollmentComplete: false,
          ejemEmail: ejemEmailLower,
          searchable: false,
        },
      },
      language: 'en',
      // App-scoped since issue #369; the shared constant is the single

      // source for the product defaults.

      notifPrefs: DEFAULT_NOTIF_PREFS,
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
