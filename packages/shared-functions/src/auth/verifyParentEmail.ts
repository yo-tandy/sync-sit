import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as crypto from 'crypto';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { sendVerificationEmail, normalizeAccountExistsApp } from '../config/email.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { handleExistingAccountSignup } from './accountExistsNotice.js';
import { isInSendCooldown } from './sendCooldown.js';
import { registerVerificationSend } from './sendRateLimit.js';

/**
 * Send a 6-digit verification code to any email address (for parent enrollment).
 * Unlike verifyEjmEmail, this accepts any domain.
 */
export const verifyParentEmail = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    // `app` is an untrusted display-only hint (which app's copy the
    // account-exists email uses) — normalized inside the silent path.
    const { email, app } = request.data as { email: string; app?: unknown };

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
      throw new HttpsError('invalid-argument', 'A valid email is required');
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if account already exists
    const existingUsers = await db
      .collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    // Per-address send cooldown, AFTER the existence query — a structural
    // mirror of verifyEjmEmail (query -> cooldown -> branch work) for
    // code-shape parity. There is no authed own-email bypass here (parent
    // signup is always unauthenticated at this step), so the cooldown applies
    // to both branches and this reordering changes no behavior.
    if (await isInSendCooldown(normalizedEmail)) {
      return { success: true, message: 'Verification code sent' };
    }

    // Per-address daily send cap (issue #155), cooldown first so short
    // repeats never consume budget. The counter doc is keyed by the
    // normalized address, so the budget is SHARED with verifyEjmEmail.
    // Capped requests return the byte-identical fresh body and write nothing
    // on either branch — an error here would be a new abuse oracle.
    if (!(await registerVerificationSend(normalizedEmail))) {
      return { success: true, message: 'Verification code sent' };
    }

    if (!existingUsers.empty) {
      // Silent existing-account path (issue #148): do NOT throw — an error
      // here is an account-enumeration oracle. The response is identical to
      // the fresh path, a DECOY code doc byte-shaped like the fresh write
      // below keeps every downstream error identical too, and the mailbox
      // owner gets an account-exists email (rate-limited) instead of a code.
      // Unlike verifyEjmEmail there is no authed own-email bypass: parent
      // signup is always unauthenticated at this step.
      return handleExistingAccountSignup(normalizedEmail, app, {
        code: crypto.randomInt(100000, 999999).toString(),
        email: normalizedEmail,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0,
        createdAt: new Date(),
      });
    }

    // Generate cryptographically secure 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store verification code
    await db.collection('verificationCodes').doc(normalizedEmail).set({
      code,
      email: normalizedEmail,
      expiresAt,
      attempts: 0,
      createdAt: new Date(),
    });

    // Branded per app (issue #156): the same untrusted display-only hint
    // the account-exists path already normalizes.
    await sendVerificationEmail(normalizedEmail, code, normalizeAccountExistsApp(app));

    await writeUserActivity('system', 'verification_email_sent', { email: normalizedEmail });

    return { success: true, message: 'Verification code sent' };
  }
);
