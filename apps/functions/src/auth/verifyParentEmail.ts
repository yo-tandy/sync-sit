import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as crypto from 'crypto';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { sendVerificationEmail } from '../config/email.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

/**
 * Send a 6-digit verification code to any email address (for parent enrollment).
 * Unlike verifyEjmEmail, this accepts any domain.
 */
export const verifyParentEmail = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const { email } = request.data as { email: string };

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
      throw new HttpsError('already-exists', 'An account with this email already exists');
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
