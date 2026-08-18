import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as crypto from 'crypto';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { validateEjmEmail } from '@ejm/sit-core';
import { sendVerificationEmail } from '../config/email.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { handleExistingAccountSignup } from './accountExistsNotice.js';
import { isInSendCooldown } from './sendCooldown.js';
import { registerVerificationSend, registerBypassSend } from './sendRateLimit.js';

/**
 * Send a 6-digit verification code to an EJM email address.
 * Stores the code in Firestore for later verification.
 */
export const verifyEjmEmail = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    // `app` is an untrusted display-only hint (which app's copy the
    // account-exists email uses) — normalized inside the silent path.
    const { email, app } = request.data as { email: string; app?: unknown };

    if (!email) {
      throw new HttpsError('invalid-argument', 'Email is required');
    }

    // Normalize ONCE and use everywhere (mirrors verifyParentEmail). The
    // silent path's central guarantee is the exact-match users query below:
    // an untrimmed "victim28@ejm.org " would miss it and route an existing
    // account down the fresh branch (real code emailed, no account-exists
    // notice, per-variant cooldown slots).
    const normalizedEmail = email.trim().toLowerCase();

    // Check if email is pre-approved (for test/invite accounts)
    const preapprovedDoc = await db.collection('preapprovedEmails').doc(normalizedEmail).get();
    const isPreapproved = preapprovedDoc.exists && preapprovedDoc.data()?.used === false;

    // Skip EJM domain validation if pre-approved
    let graduationYear: number | null = null;
    if (!isPreapproved) {
      const validation = validateEjmEmail(normalizedEmail);
      if (!validation.valid) {
        throw new HttpsError('invalid-argument', validation.error!);
      }
      graduationYear = validation.graduationYear ?? null;
    }

    // Check if the email already belongs to an account. An authenticated
    // caller may verify their OWN account email (cross-app add-profile:
    // e.g. a babysitter whose account email is their EJM email enrolling
    // as a tutor) — anyone else's email is still rejected.
    // limit(1) assumes at most one user doc per email (enforced by the
    // enrollment write paths); the own-email bypass below relies on it.
    const existingUsers = await db
      .collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    // Whether the caller is the authenticated owner of this email (cross-app
    // add-profile). The bypass is EXEMPT from the send cooldown below: an
    // unauthenticated prober refreshes the doc's createdAt on every probe
    // (deliberately, for fresh/silent symmetry), so gating the bypass on it
    // would let that prober starve the owner's own "send code" indefinitely.
    // The bypass is authenticated and for the caller's own email —
    // distinguishable by design, not an oracle.
    const isOwnEmailBypass = !existingUsers.empty && existingUsers.docs[0].id === request.auth?.uid;

    if (!existingUsers.empty && !isOwnEmailBypass) {
      // Silent existing-account path (issue #148): do NOT throw — an error
      // here is an account-enumeration oracle. The response is identical to
      // the fresh path, a DECOY code doc byte-shaped like the fresh write
      // below keeps every downstream error identical too, and the mailbox
      // owner gets an account-exists email (rate-limited) instead of a code.
      // Per-address send cooldown first — the fresh branch below runs the
      // identical check at the identical point (query -> cooldown -> work).
      if (await isInSendCooldown(normalizedEmail)) {
        return { success: true, message: 'Verification code sent' };
      }
      // Per-address daily send cap (issue #155), cooldown first so short
      // repeats never consume budget. Capped requests stay SILENT and write
      // nothing — not even a decoy refresh — exactly mirroring the capped
      // fresh branch below, so the cap is not a new oracle.
      if (!(await registerVerificationSend(normalizedEmail))) {
        return { success: true, message: 'Verification code sent' };
      }
      return handleExistingAccountSignup(normalizedEmail, app, {
        code: crypto.randomInt(100000, 999999).toString(),
        email: normalizedEmail,
        graduationYear,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0,
        createdAt: new Date(),
      });
    }

    // Per-address send cooldown for the FRESH path (mirrors the silent
    // branch above: query -> cooldown -> work). The authed own-email bypass
    // skips it — see isOwnEmailBypass.
    if (!isOwnEmailBypass && (await isInSendCooldown(normalizedEmail))) {
      return { success: true, message: 'Verification code sent' };
    }

    // Per-address daily send cap (issue #155), cooldown first — the silent
    // branch above runs the identical pair at the identical point. Capped
    // requests return the byte-identical fresh body and write NOTHING (no
    // code doc, no counter bump — the window is fixed, not sliding): an
    // error here would be a new abuse oracle. The bypass is exempt (a prober
    // could burn the address budget to starve the owner — same vector as the
    // cooldown exemption); it has its own per-uid allowance below.
    if (!isOwnEmailBypass && !(await registerVerificationSend(normalizedEmail))) {
      return { success: true, message: 'Verification code sent' };
    }

    // Authed own-email bypass allowance (issue #155, the #154 residual):
    // without this the bypass had NO server-side send limit. This path is
    // authenticated and self-directed, so an explicit error is safe (nothing
    // to enumerate) and better UX than silent mail loss.
    if (isOwnEmailBypass && request.auth && !(await registerBypassSend(request.auth.uid))) {
      throw new HttpsError(
        'failed-precondition',
        'Too many verification emails requested for this account. Please wait up to an hour and try again.'
      );
    }

    // Generate cryptographically secure 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store verification code
    await db.collection('verificationCodes').doc(normalizedEmail).set({
      code,
      email: normalizedEmail,
      graduationYear,
      expiresAt,
      attempts: 0,
      createdAt: new Date(),
    });

    await sendVerificationEmail(normalizedEmail, code);

    await writeUserActivity('system', 'verification_email_sent', { email: normalizedEmail });

    return { success: true, message: 'Verification code sent' };
  }
);
