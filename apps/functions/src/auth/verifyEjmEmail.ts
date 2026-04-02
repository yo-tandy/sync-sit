import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as crypto from 'crypto';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { validateEjmEmail } from '@ejm/shared';
import { sendVerificationEmail } from '../config/email.js';
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

    // Check if email is pre-approved (for test/invite accounts)
    const preapprovedDoc = await db.collection('preapprovedEmails').doc(email.toLowerCase()).get();
    const isPreapproved = preapprovedDoc.exists && preapprovedDoc.data()?.used === false;

    // Skip EJM domain validation if pre-approved
    let graduationYear: number | null = null;
    if (!isPreapproved) {
      const validation = validateEjmEmail(email);
      if (!validation.valid) {
        throw new HttpsError('invalid-argument', validation.error!);
      }
      graduationYear = validation.graduationYear ?? null;
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
      graduationYear,
      expiresAt,
      attempts: 0,
      createdAt: new Date(),
    });

    await sendVerificationEmail(email.toLowerCase(), code);

    await writeUserActivity('system', 'verification_email_sent', { email });

    return { success: true, message: 'Verification code sent' };
  }
);
