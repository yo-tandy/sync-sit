import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { strongPasswordSchema } from '@ejm/sit-core';
import {
  DEFAULT_NOTIF_PREFS,
  validateEjmEmail,
  checkEnrollmentAge,
  getEjemEmail,
  getContact,
  type User,
} from '@ejm/shared-core';
import {
  TASK_CATEGORIES,
  isCalendarDate,
  validateDoerBio,
  validateDoerCategories,
  validateDoerDefaultRate,
  type TaskCategory,
} from '@ejm/do-core';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { assertCodeIdentityClass } from '@ejm/shared-functions/auth/verificationCodeClass.js';
import {
  addProfileToUser,
  assertCanAddProfile,
} from '@ejm/shared-functions/enrollment/addProfileToUser.js';
import { calculateAge } from '../search/ageBackstop.js';
import { toDobDate } from './dob.js';

interface DoerEnrollmentInput {
  // Identity is absent when already on file (issue #144 set-once rule) —
  // EXCEPT dateOfBirth, which the §11.1 age gate makes mandatory when the
  // doc lacks one (the modal enrollee is a cross-app babysitter whose sit
  // profile may well lack a DOB, so the abbreviated flow must be able to
  // ask for it).
  firstName?: string;
  lastName?: string;
  /** "YYYY-MM-DD" */
  dateOfBirth?: string;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
  /** Absent → ALL seven (the modal intent stated as data, §3.3). */
  categories?: TaskCategory[];
  bio?: string;
  defaultRate?: number | null;
  hasCar?: boolean;
  hasBike?: boolean;
  notifyNewTasks?: boolean;
}

interface EnrollDoerData {
  ejemEmail?: string;
  verificationCode?: string;
  password?: string;
  consentVersion: string;
  /**
   * Cross-app switch (§3.3, the sit↔study Plan D pattern): a signed-in
   * caller whose account already holds a COMPLETED babysitter or tutor
   * profile adds `profiles.doer` without re-proving mailbox ownership —
   * that EJM identity was verified when the provider profile was made
   * (plan §8's abbreviated half of the identity gate). A parent profile
   * does NOT qualify — see the gate below (§11.1 as corrected in PR #320).
   */
  crossApp?: boolean;
  enrollment?: DoerEnrollmentInput;
}

const NAME_MAX = 100;
const CONTACT_MAX = 200;
/** The platform's contact-email validator — study's tutor enrollment schema
 *  uses the same zod shape (`tutor.ts:88`). */
const contactEmailShape = z.string().email();
/**
 * Phone/WhatsApp shape (PR #320 round 3). NO platform precedent exists —
 * sit and study both accept bare strings (`tutor.ts:89-90`,
 * `sit-core/validation/enrollment.ts:57`) — so this is the new one, stated:
 * a plausible phone is drawn from the phone charset (digits, spaces,
 * parens, dots, dashes, optional leading +) and carries at least 6 digits.
 * Deliberately loose (no country/format semantics): the point is only that
 * junk like 'x' cannot be the channel that satisfies the ≥1-contact
 * requirement — decision 16's reveal must serve something dialable.
 */
function isPlausiblePhone(v: string): boolean {
  return /^\+?[0-9 ().-]+$/.test(v) && v.replace(/\D/g, '').length >= 6;
}

/** Manual guards in the publishSearch house style (plan §8). */
function validateEnrollmentInput(input: unknown): DoerEnrollmentInput {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpsError('invalid-argument', 'enrollment must be an object');
  }
  const e = input as Record<string, unknown>;

  for (const key of ['firstName', 'lastName'] as const) {
    const v = e[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.trim().length === 0 || v.length > NAME_MAX) {
      throw new HttpsError(
        'invalid-argument',
        `${key} must be a non-empty string of at most ${NAME_MAX} characters`,
      );
    }
  }
  if (e.dateOfBirth !== undefined) {
    if (typeof e.dateOfBirth !== 'string' || !isCalendarDate(e.dateOfBirth)) {
      throw new HttpsError('invalid-argument', 'Date of birth is invalid');
    }
  }
  for (const key of ['contactEmail', 'contactPhone', 'whatsapp'] as const) {
    const v = e[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length > CONTACT_MAX) {
      throw new HttpsError(
        'invalid-argument',
        `${key} must be a string of at most ${CONTACT_MAX} characters`,
      );
    }
  }
  // Every channel also gets a SHAPE check (PR #320 rounds 2-3): any one of
  // them can satisfy the ≥1-contact requirement and lands at the canonical
  // root, so junk like 'x' must not count as "something for decision 16's
  // reveal to serve" — and the guarantee is only as strong as the WEAKEST
  // accepted channel. Email: study's tutor-schema validator
  // (z.string().email()). Phone/WhatsApp: isPlausiblePhone above (the new
  // precedent — the siblings have none).
  if (typeof e.contactEmail === 'string' && e.contactEmail.trim()) {
    if (!contactEmailShape.safeParse(e.contactEmail.trim()).success) {
      throw new HttpsError('invalid-argument', 'Invalid contact email');
    }
  }
  if (typeof e.contactPhone === 'string' && e.contactPhone.trim()) {
    if (!isPlausiblePhone(e.contactPhone.trim())) {
      throw new HttpsError('invalid-argument', 'Invalid contact phone');
    }
  }
  if (typeof e.whatsapp === 'string' && e.whatsapp.trim()) {
    if (!isPlausiblePhone(e.whatsapp.trim())) {
      throw new HttpsError('invalid-argument', 'Invalid WhatsApp number');
    }
  }
  if (e.categories !== undefined) {
    const err = validateDoerCategories(e.categories);
    if (err) throw new HttpsError('invalid-argument', err);
  }
  if (e.bio !== undefined) {
    const err = validateDoerBio(e.bio);
    if (err) throw new HttpsError('invalid-argument', err);
  }
  if (e.defaultRate !== undefined) {
    const err = validateDoerDefaultRate(e.defaultRate);
    if (err) throw new HttpsError('invalid-argument', err);
  }
  for (const key of ['hasCar', 'hasBike', 'notifyNewTasks'] as const) {
    if (e[key] !== undefined && typeof e[key] !== 'boolean') {
      throw new HttpsError('invalid-argument', `${key} must be a boolean`);
    }
  }
  return e as DoerEnrollmentInput;
}

/**
 * `doEnrollDoer` — creates `profiles.doer` (plan §8, §3.3, §11.1).
 *
 * Identity gate first: `enrollmentComplete` is set only for a caller with a
 * VERIFIED EJM identity — either an account already holding a completed
 * sit/study PROVIDER profile (babysitter/tutor, the abbreviated crossApp
 * path — both are EJM-email-verified at their own enrollment), or the
 * `enrollTutor`-shape emailed-code verification, which here also asserts
 * the address itself is EJM-valid or admin-preapproved BEFORE consulting
 * the code (issue #322: the verificationCodes namespace is shared with the
 * any-domain verifyParentEmail, so a code alone proves only mailbox
 * ownership). A PARENT profile does NOT qualify (§11.1 as corrected in PR
 * #320): `verifyParentEmail` accepts any domain and `enrollFamily`
 * completes on open self-signup, so accepting it would make §7.2's board
 * audience "anyone with a mailbox". A parent-only account can still enroll
 * as a doer, but only through the code path's EJM/preapproved acceptance
 * set — which in V1 effectively excludes parents (§1's doers are EJM
 * students; a one-line change here if the owner ever wants otherwise).
 * Without this gate the §7.2 board read rule would be satisfiable by any
 * authenticated account.
 *
 * Then the age gate, exactly as §11.1 states it: every caller must present
 * a parseable dateOfBirth (missing/NaN → invalid-argument, checked before
 * any governance branch); an UNGOVERNED caller under 15 is refused on a
 * bare age-from-DOB check — deliberately NOT enrollTutor's email-guarded
 * floor shape, whose floor stands down when the EJM email doesn't parse
 * (`enrollTutor.ts:263`); a governed caller passes the floor at any age
 * (supervision is their protection). `checkEnrollmentAge` runs only for
 * the ±1-class `age_mismatch` half, only when the email yields a
 * graduation year.
 */
export const doEnrollDoer = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const data = request.data as EnrollDoerData;
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

    // 2. Require consent. Bounded, not just truthy: the value lands on the
    // root consentVersion of an EXISTING account on the add-profile path
    // (setBaseFields below), so an arbitrary client blob must not reach it
    // (PR #320 round 1).
    if (
      !data.consentVersion ||
      typeof data.consentVersion !== 'string' ||
      data.consentVersion.length > 32
    ) {
      throw new HttpsError('invalid-argument', 'Consent is required');
    }

    // The caller doc feeds the later checks (crossApp identity, governance
    // bypass, stored DOB/identity presence) — fetch it once, up front.
    let callerData: Record<string, unknown> = {};
    if (isAddProfile) {
      const callerSnap = await db.collection('users').doc(request.auth!.uid).get();
      callerData = callerSnap.data() ?? {};
    }

    // 3. Establish the verified EJM identity (the §11.1 identity gate).
    // Cross-app: the caller's existing COMPLETED PROVIDER profile is the
    // proof — that identity was verified by a real EJM-emailed-code
    // enrollment. PARENT deliberately absent from this list (docstring):
    // parent identity is any-domain self-signup and proves no EJM
    // affiliation. Note `enrollmentComplete === true`: sit creates its
    // babysitter profile incomplete and completes it later, and an
    // abandoned half-enrollment proves nothing.
    // Classic (new account, or an authed account with no completed provider
    // profile — a governed kid, or a parent who genuinely holds an EJM
    // address): verify the emailed code — the enrollTutor shape.
    let ejemEmailLower: string;
    let codeDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    if (isCrossApp) {
      const profiles = (callerData.profiles ?? {}) as Record<string, Record<string, unknown> | undefined>;
      const hasCompletedProviderProfile = (['babysitter', 'tutor'] as const).some(
        (key) => profiles[key]?.enrollmentComplete === true,
      );
      if (!hasCompletedProviderProfile) {
        throw new HttpsError('failed-precondition', 'No verified EJM identity on this account');
      }
      // May be absent on legacy docs; the doer profile stores no email copy
      // (root identity is canonical, issue #203), so it is only consulted
      // for the age_mismatch half below.
      ejemEmailLower = getEjemEmail(callerData as unknown as User)?.toLowerCase() ?? '';
    } else {
      if (!data.ejemEmail || typeof data.ejemEmail !== 'string') {
        throw new HttpsError('invalid-argument', 'EJM email is required');
      }
      // Normalize ONCE and use everywhere — trim AND lowercase, the
      // verifyEjmEmail.ts:31 rule (PR #320 round 3): both code writers key
      // verificationCodes by the trimmed+lowered address, so an untrimmed
      // key here could only miss (fail closed) — but a confusing not-found
      // for a direct caller, and an untrimmed address handed to
      // adminAuth.createUser, are both still wrong.
      ejemEmailLower = data.ejemEmail.trim().toLowerCase();
      // "A code exists" does NOT prove an EJM mailbox (PR #320 round 2 /
      // issue #322): verifyParentEmail is public, accepts ANY domain, and
      // writes the SAME verificationCodes/{email} namespace this branch
      // reads — so without a domain check, anyone with any mailbox could
      // mint a code there and satisfy the identity gate. Assert the address
      // is one verifyEjmEmail would have issued to, mirroring its exact
      // acceptance set (verifyEjmEmail.ts): admin-preapproved
      // (`preapprovedEmails/{email}` with used === false — test/invite
      // accounts), else EJM-valid per validateEjmEmail (domain + in-window
      // graduation year).
      //
      // KEPT after the #322 source fix, deliberately — this is not dead
      // code. The code doc now states its own identity class and the
      // assertion below grades it, which is the platform fix; this check is
      // sync-do's independent second lock. It is what made the do path
      // correct BEFORE the stamp existed (so it, not the stamp, covers any
      // unstamped legacy doc), it re-derives the fact from the address
      // rather than trusting a stored field, and it survives a future writer
      // that stamps `ejm` too loosely. Defence in depth: do NOT delete it as
      // now-redundant. The two differ where verifyEjmEmail's graduation-year
      // window has since moved on — an address valid when the code was
      // issued can fail here — which fails closed and is fine.
      const preapprovedDoc = await db.collection('preapprovedEmails').doc(ejemEmailLower).get();
      const isPreapproved = preapprovedDoc.exists && preapprovedDoc.data()?.used === false;
      if (!isPreapproved) {
        const domainCheck = validateEjmEmail(ejemEmailLower);
        if (!domainCheck.valid) {
          throw new HttpsError(
            'failed-precondition',
            'An EJM email address is required to enroll as a doer.',
            { reason: 'not_ejm_email' },
          );
        }
      }
      codeDoc = await db.collection('verificationCodes').doc(ejemEmailLower).get();

      if (!codeDoc.exists) {
        throw new HttpsError('not-found', 'No verification code found. Please request a new one.');
      }

      const codeData = codeDoc.data()!;

      // The platform half of the same fact (issue #322): the code doc must
      // itself state that it proves an EJM identity, i.e. verifyEjmEmail
      // issued it. Complements — never replaces — the address check above.
      // Transitional: a doc written before #322 carries no stamp and reads
      // as the weakest class, so it lands here — an enrollment in flight
      // across the deploy must request a new code (codes live 10 minutes;
      // the fallback can go once one code lifetime has passed post-deploy).
      // Placed before the expiry/attempts/comparison checks: the refusal is
      // about what the doc IS, so it must not burn a brute-force attempt.
      assertCodeIdentityClass(codeData, 'ejm');

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

    // 4. Validate the enrollment payload (manual guards, do-core bounds).
    const enrollment = validateEnrollmentInput(data.enrollment);

    // Identity coherence (issue #144): root identity is set-once. A new
    // account must supply both names; an add-profile caller may omit any
    // field the doc already holds, but the merged result must be complete.
    const hasFirstName = !!enrollment.firstName || !!callerData.firstName;
    const hasLastName = !!enrollment.lastName || !!callerData.lastName;
    if (!hasFirstName || !hasLastName) {
      throw new HttpsError('invalid-argument', 'First name and last name are required');
    }

    // At least one contact channel, on EVERY path — the enrollTutor
    // precedent (enrollTutor.ts:212-214, enforced on its crossApp path
    // too), so doGetAssignedContact (decision 16) always has something to
    // reveal. Not guaranteed by the account alone: sit's enrollment makes
    // contact skippable (issue #203), so a completed babysitter can carry
    // zero channels — the wizard shows the contact fields on the
    // abbreviated path exactly when the account has none (PR #320 round 1).
    {
      const canonical = getContact(callerData as unknown as User);
      const hasContact =
        !!enrollment.contactEmail?.trim() || !!enrollment.contactPhone?.trim() ||
        !!enrollment.whatsapp?.trim() || !!canonical.contactEmail ||
        !!canonical.contactPhone || !!canonical.whatsapp;
      if (!hasContact) {
        throw new HttpsError('invalid-argument', 'At least one contact field is required');
      }
    }

    // 5. The §11.1 age gate — every clause deliberate, see the docstring.
    // The gate runs against the doc's DOB when one is on file (the set-once,
    // trusted value) and the payload DOB otherwise.
    const storedDob = toDobDate(callerData.dateOfBirth);
    const gateDob = storedDob
      ?? (enrollment.dateOfBirth ? new Date(enrollment.dateOfBirth) : null);
    // Unconditional parseable-DOB requirement, BEFORE any governance branch
    // (§11.1 takes enrollTutor.ts:256-260's side against sit's legacy
    // tolerance: this is an enrollment gate on a new profile, and the flow
    // collects the DOB — "never let a security gate no-op silently").
    if (!gateDob) {
      throw new HttpsError('invalid-argument', 'Date of birth is required');
    }
    if (Number.isNaN(gateDob.getTime())) {
      throw new HttpsError('invalid-argument', 'Date of birth is invalid');
    }
    // GOVERNED bypass: an ACTIVE guardianLinks doc carries the server-owned
    // governedBy mirror and a parent-attested DOB — supervision, not gating,
    // is its protection, so the floor stands down. Only the add-profile path
    // can be governed (a governed kid always has an account).
    const isGoverned = !!callerData.governedBy;
    // The under-15 floor, computed from the DOB ALONE — sit's bare shape
    // (searchBabysitters.ts:212-213) at enrollTutor's timing. Deliberately
    // NOT gated on the EJM email parsing: the modal enrollee is a legacy
    // cross-app account whose stored email may not parse, and enrollTutor's
    // email-guarded floor stands down exactly there (§11.1's deviation).
    if (!isGoverned && calculateAge(gateDob) < 15) {
      throw new HttpsError(
        'failed-precondition',
        'You need to be at least 15 to enroll on your own. Your parents can create an account and enroll you from theirs.',
        // `reason` is the plan-normative field (§8); `code` feeds the
        // shared-ui ageGateErrorCode mapper the wizards already use.
        { reason: 'under_15', code: 'age/under-15' },
      );
    }
    // checkEnrollmentAge is consulted ONLY for the ±1-class age_mismatch
    // half, only when the email yields a graduation year (§11.1).
    const emailCheck = validateEjmEmail(ejemEmailLower);
    if (!isGoverned && emailCheck.valid && emailCheck.graduationYear !== undefined) {
      const verdict = checkEnrollmentAge({
        dateOfBirth: gateDob,
        graduationYear: emailCheck.graduationYear,
      });
      if (verdict === 'age_mismatch') {
        const exemption = await db.collection('enrollmentExemptions').doc(ejemEmailLower).get();
        if (!exemption.exists) {
          throw new HttpsError(
            'failed-precondition',
            "Your date of birth doesn't match your school year. Please contact the EJM administrator.",
            { reason: 'age_mismatch', code: 'age/mismatch' },
          );
        }
      }
    }

    // 6. Build the doer profile — enrollmentComplete only here, at the end,
    // after both gates (§8). Categories default to ALL seven: the modal
    // intent stated as data (§3.3 — an empty array means "no digests", so
    // "empty = all" would silently invert the digest query).
    const now = new Date();
    const doerProfile = {
      enrollmentComplete: true,
      notifyNewTasks: enrollment.notifyNewTasks ?? true,
      categories: enrollment.categories ?? [...TASK_CATEGORIES],
      bio: enrollment.bio?.trim() || null,
      defaultRate: enrollment.defaultRate ?? null,
      hasCar: enrollment.hasCar ?? false,
      hasBike: enrollment.hasBike ?? false,
    };

    const dobTimestamp = enrollment.dateOfBirth
      ? Timestamp.fromDate(new Date(enrollment.dateOfBirth))
      : undefined;

    // 6a. Add-profile path — an authenticated existing user gains the doer
    // profile. NO schedule doc: sync-do never touches schedules/{uid}
    // (decision 10), which is also why there is no preflight-then-create
    // dance here — addProfileToUser's transaction is the only write.
    if (isAddProfile) {
      const uid = request.auth!.uid;
      await assertCanAddProfile(uid, 'doer');
      await addProfileToUser({
        uid,
        profileKey: 'doer',
        profileData: doerProfile,
        // Root shared-identity fields (issue #203): set-once, empty-only —
        // an existing value always wins. The DOB the wizard collected for a
        // doc that lacked one is persisted here (§11.1: the abbreviated
        // flow must be able to ask for it).
        fillBaseFields: {
          firstName: enrollment.firstName,
          lastName: enrollment.lastName,
          dateOfBirth: dobTimestamp,
          ...(ejemEmailLower ? { ejemEmail: ejemEmailLower } : {}),
        },
        // Contact the user just typed wins over an older root copy (the
        // PR #206 rule); empty/absent means "leave it alone", never "clear".
        // consentAt/consentVersion: §11.4's bullet — the abbreviated
        // enrollment still records consent for the SYNC-DO terms. The root
        // pair moves to the newest accepted version (prior acceptances stay
        // in the audit trail, and this callable never runs without a fresh
        // consent tick), which is why these ride setBaseFields rather than
        // the audit-only convention addProfileToUser defaults to.
        // Consequence, stated plainly (PR #320 round 2): the root pair is a
        // single latest-wins slot with no app label — after this write, the
        // account's root-level consent record is sync-do's version string,
        // and the earlier sit/study acceptance survives only in
        // userActivity. Nothing gates on the root pair today; if a
        // re-consent check ever keys on it, per-app consent needs its own
        // ledger (future work — a per-app consent map).
        setBaseFields: {
          ...(enrollment.contactEmail?.trim() ? { contactEmail: enrollment.contactEmail.trim() } : {}),
          ...(enrollment.contactPhone?.trim() ? { contactPhone: enrollment.contactPhone.trim() } : {}),
          ...(enrollment.whatsapp?.trim() ? { whatsapp: enrollment.whatsapp.trim() } : {}),
          consentAt: now,
          consentVersion: data.consentVersion,
        },
        auditAction: 'doer.profile_added',
        auditDetails: {
          ...(ejemEmailLower ? { ejemEmail: ejemEmailLower } : {}),
          consentVersion: data.consentVersion,
          categories: doerProfile.categories,
          ...(isCrossApp ? { crossApp: true } : {}),
        },
      });
      if (codeDoc) await codeDoc.ref.delete();
      return { uid };
    }

    // 6b. New-account path — the presence checks above guarantee the payload
    // carries the full identity (callerData is empty here).
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
        // Race backstop only: reaching here requires a valid emailed code,
        // so this is not an enumeration oracle (the caller owns the mailbox).
        throw new HttpsError('already-exists', 'An account with this email already exists');
      }
      throw new HttpsError('internal', 'Failed to create account');
    }

    // Plan D user doc with profiles.doer. Contact channels the user never
    // supplied are OMITTED, not written as null: root presence means "the
    // user set or cleared this" (PR #206). No schedules/{uid} (decision 10).
    await db.collection('users').doc(uid).set({
      uid,
      email: ejemEmailLower,
      firstName: enrollment.firstName!,
      lastName: enrollment.lastName!,
      dateOfBirth: dobTimestamp!,
      ejemEmail: ejemEmailLower,
      ...(enrollment.contactEmail?.trim() ? { contactEmail: enrollment.contactEmail.trim() } : {}),
      ...(enrollment.contactPhone?.trim() ? { contactPhone: enrollment.contactPhone.trim() } : {}),
      ...(enrollment.whatsapp?.trim() ? { whatsapp: enrollment.whatsapp.trim() } : {}),
      status: 'active',
      language: 'en',
      // App-scoped since issue #369; the shared constant is the single

      // source for the product defaults.

      notifPrefs: DEFAULT_NOTIF_PREFS,
      fcmTokens: [],
      profiles: {
        doer: doerProfile,
      },
      consentAt: now,
      consentVersion: data.consentVersion,
      createdAt: now,
      updatedAt: now,
    });

    await writeUserActivity(uid, 'doer.enroll', {
      uid,
      ejemEmail: ejemEmailLower,
      categories: doerProfile.categories,
    });

    // Delete the consumed verification code (always present on this path).
    if (codeDoc) await codeDoc.ref.delete();

    return { uid };
  },
);
