import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as crypto from 'crypto';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { sendVerificationEmail } from '../config/email.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { handleExistingAccountSignup } from './accountExistsNotice.js';

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

    if (!existingUsers.empty) {
      // Silent existing-account path (issue #148): do NOT throw — an error
      // here is an account-enumeration oracle. The response is identical to
      // the fresh path, no code doc is written, and the mailbox owner gets an
      // account-exists email (rate-limited) instead of a code. Unlike
      // verifyEjmEmail there is no authed own-email bypass: parent signup is
      // always unauthenticated at this step.
      return handleExistingAccountSignup(normalizedEmail, app);
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

    await sendVerificationEmail(normalizedEmail, code);

    await writeUserActivity('system', 'verification_email_sent', { email });

    return { success: true, message: 'Verification code sent' };
  }
);
