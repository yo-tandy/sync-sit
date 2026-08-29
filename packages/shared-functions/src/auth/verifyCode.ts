import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getConfigValue } from '../config/adminConfig.js';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { FieldValue } from 'firebase-admin/firestore';
import { assertCodeIdentityClass } from './verificationCodeClass.js';


/**
 * Check an emailed code without consuming it — the wizards' "verify" step,
 * ahead of the enroll callable that does the real work.
 *
 * `requireIdentityClass` (issue #322) states which identity class the CALLING
 * WIZARD's enrollment will demand, so a code of the wrong class fails at the
 * code step instead of after the user has filled the rest of the form. It is
 * a client-supplied UX hint and NOT a security boundary: it can only tighten
 * this pre-check, this callable grants nothing, and the enroll callables
 * assert their own requirement server-side regardless of what was passed
 * here. Absent or unrecognized => 'mailbox', which is exactly what this
 * callable accepted before the parameter existed (both issuers prove mailbox
 * ownership), so old clients are unaffected.
 */
export const verifyCode = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const { email, code, requireIdentityClass } = request.data as {
      email: string;
      code: string;
      requireIdentityClass?: unknown;
    };

    if (!email || !code) {
      throw new HttpsError('invalid-argument', 'Missing email or code');
    }

    const codeRef = db.collection('verificationCodes').doc(email.toLowerCase());
    const codeDoc = await codeRef.get();

    if (!codeDoc.exists) {
      throw new HttpsError('not-found', 'No verification code found. Please request a new one.');
    }

    const codeData = codeDoc.data()!;

    // Before the expiry/attempts/comparison checks: a wrong-class code is
    // refused on what the DOC is, so it must not burn a brute-force attempt.
    assertCodeIdentityClass(codeData, requireIdentityClass === 'ejm' ? 'ejm' : 'mailbox');

    if (codeData.expiresAt.toDate() < new Date()) {
      throw new HttpsError('deadline-exceeded', 'Verification code has expired. Please request a new one.');
    }

    // Rate limiting: check attempt count
    const attempts = codeData.attempts || 0;
    const maxAttempts = await getConfigValue('verifyCodeMaxAttempts');
    if (attempts >= maxAttempts) {
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
