import { callableErrorCode, verificationCodeError } from '../utils/callableErrors.js';

// i18n keys for enrollment callable failures. Every consuming app defines
// these keys (en + fr). Never fall back to err.message: an unexpected server
// fault arrives as the bare token 'internal', and the deliberate server
// messages are English-only.

function codeErrorKey(err: unknown): string | null {
  switch (verificationCodeError(err)) {
    case 'expired':
      return 'auth.codeExpired';
    case 'too-many-attempts':
      return 'auth.tooManyAttempts';
    case 'wrong-class':
      return 'auth.codeWrongClass';
    default:
      return null;
  }
}

/** A `verifyCode` rejection: there, invalid-argument means a wrong code. */
export function verifyCodeErrorKey(err: unknown): string {
  return (
    codeErrorKey(err) ??
    (callableErrorCode(err) === 'invalid-argument' ? 'auth.invalidCode' : 'enrollment.serverError')
  );
}

/**
 * A final-step enroll* rejection (enrollStudentIdentity, enrollFamily,
 * enrollBabysitter, enrollTutor, enrollDoer), for whatever the page's own
 * reason/age-gate mapping did not claim. The code was already accepted by
 * `verifyCode` one step earlier, so invalid-argument here is a form field
 * the server's schema refused. No account-exists copy: the server's
 * already-exists race stays generic (signup with an existing email is
 * silent, issue #148).
 */
export function enrollmentSubmitErrorKey(err: unknown): string {
  return (
    codeErrorKey(err) ??
    (callableErrorCode(err) === 'invalid-argument' ? 'enrollment.submitInvalid' : 'enrollment.serverError')
  );
}
