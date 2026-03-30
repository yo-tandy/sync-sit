import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { FieldValue } from 'firebase-admin/firestore';

const MAX_ATTEMPTS = 5;

export const verifyCode = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const { email, code } = request.data as { email: string; code: string };

    if (!email || !code) {
      throw new HttpsError('invalid-argument', 'Missing email or code');
    }

    const codeRef = db.collection('verificationCodes').doc(email.toLowerCase());
    const codeDoc = await codeRef.get();

    if (!codeDoc.exists) {
      throw new HttpsError('not-found', 'No verification code found. Please request a new one.');
    }

    const codeData = codeDoc.data()!;

    if (codeData.expiresAt.toDate() < new Date()) {
      throw new HttpsError('deadline-exceeded', 'Verification code has expired. Please request a new one.');
    }

    // Rate limiting: check attempt count
    const attempts = codeData.attempts || 0;
    if (attempts >= MAX_ATTEMPTS) {
      throw new HttpsError(
        'resource-exhausted',
        'Too many failed attempts. Please request a new verification code.'
      );
    }

    if (codeData.code !== code) {
      // Increment attempt counter
      await codeRef.update({ attempts: FieldValue.increment(1) });
      throw new HttpsError('invalid-argument', 'Invalid verification code');
    }

    return { valid: true };
  }
);
