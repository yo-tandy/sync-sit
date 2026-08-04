/**
 * Extracts the machine-readable enrollment error reason set by the backend
 * (HttpsError details: { reason: 'account-exists' | 'profile-exists', ... }).
 * Works on the Firebase client SDK's FunctionsError, which exposes the
 * HttpsError third argument as `details`. Returns null for anything else.
 */
export type EnrollmentErrorReason = 'account-exists' | 'profile-exists';

export function enrollmentErrorReason(err: unknown): EnrollmentErrorReason | null {
  const details = (err as { details?: { reason?: unknown } } | null)?.details;
  const reason = details?.reason;
  return reason === 'account-exists' || reason === 'profile-exists' ? reason : null;
}

/**
 * Extracts the machine-readable age-gate code set by the enrollment callables
 * (HttpsError details: { code: 'age/under-15' | 'age/mismatch' }). Returns
 * null for anything else.
 */
export type AgeGateErrorCode = 'age/under-15' | 'age/mismatch';

export function ageGateErrorCode(err: unknown): AgeGateErrorCode | null {
  const details = (err as { details?: { code?: unknown } } | null)?.details;
  const code = details?.code;
  return code === 'age/under-15' || code === 'age/mismatch' ? code : null;
}
