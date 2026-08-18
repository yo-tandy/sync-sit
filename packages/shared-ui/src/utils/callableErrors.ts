/**
 * Extracts the machine-readable enrollment error reason set by the backend
 * (HttpsError details: { reason: 'profile-exists' | 'role-exclusive' |
 * 'send-cap', ... }; 'send-cap' is the authed own-email bypass allowance of
 * issue #155 — safe to surface because only an authenticated caller acting
 * on their own address can ever receive it).
 * Works on the Firebase client SDK's FunctionsError, which exposes the
 * HttpsError third argument as `details`. Returns null for anything else.
 * There is deliberately NO account-exists reason: signup with an existing
 * email is silent (issue #148) — the backend responds like a fresh signup and
 * only the mailbox owner is told, by email.
 */
export type EnrollmentErrorReason = 'profile-exists' | 'role-exclusive' | 'send-cap';

export function enrollmentErrorReason(err: unknown): EnrollmentErrorReason | null {
  const details = (err as { details?: { reason?: unknown } } | null)?.details;
  const reason = details?.reason;
  return reason === 'profile-exists' || reason === 'role-exclusive' || reason === 'send-cap'
    ? reason
    : null;
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
