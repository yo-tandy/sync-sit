import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as crypto from 'crypto';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { validateEjmEmail } from '@ejm/shared';
import { writeUserActivity } from '../admin/writeAuditLog.js';

/**
 * Send a 6-digit verification code to an EJM email address.
 * Stores the code in Firestore for later verification.
 */
export const verifyEjmEmail = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const { email } = request.data as { email: string };

    if (!email) {
      throw new HttpsError('invalid-argument', 'Email is required');
    }

    // Validate EJM email format
    const validation = validateEjmEmail(email);
    if (!validation.valid) {
      throw new HttpsError('invalid-argument', validation.error!);
    }

    // Check if account already exists
    const existingUsers = await db
      .collection('users')
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get();

    if (!existingUsers.empty) {
      throw new HttpsError('already-exists', 'An account with this email already exists');
    }

    // Generate cryptographically secure 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store verification code
    await db.collection('verificationCodes').doc(email.toLowerCase()).set({
      code,
      email: email.toLowerCase(),
      graduationYear: validation.graduationYear,
      expiresAt,
      attempts: 0,
      createdAt: new Date(),
    });

    // TODO: Send email via Resend
    // Only log in emulator/development
    if (process.env.FUNCTIONS_EMULATOR === 'true') {
      console.log(`[DEV] Verification code for ${email}: ${code}`);
    }

    await writeUserActivity('system', 'verification_email_sent', { email });

    return { success: true, message: 'Verification code sent' };
  }
);
