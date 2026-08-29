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

/**
 * The Firebase callable error code, with the client SDK's `functions/` prefix
 * stripped, or null when the rejection carries no recognisable code.
 *
 * Why a CODE and not `err.message`: the callables throw English-only server
 * strings ('You cannot remove yourself', 'Must be logged in') and literally
 * `internal` on an unexpected fault, so echoing the message puts untranslated
 * English — or a bare error token — in front of French users. `err instanceof
 * Error` is not a usable guard either: a FunctionsError IS an Error, so an
 * `instanceof` check passes for every real rejection and any i18n fallback
 * behind it is unreachable (PR #343 round 5 — that is exactly how the
 * generate-link path kept echoing raw server text after the removal path was
 * fixed).
 *
 * Call sites map the code to their OWN message keys: the same code means
 * different things on different actions.
 */
export function callableErrorCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return null;
  return code.startsWith('functions/') ? code.slice('functions/'.length) : code;
}
