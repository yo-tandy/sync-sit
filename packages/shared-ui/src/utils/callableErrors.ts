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
 * Extracts the machine-readable error code from a `deleteMyAccount`
 * rejection (HttpsError details: { code: 'admin/last-admin' }, issue #421 /
 * PR #490). `eraseUserAccount` -- the ONE erasure body both `deleteUser`
 * (admin) and `deleteMyAccount` (self-serve) call -- refuses to erase the
 * platform's last active admin, so a member who is that admin can hit this
 * from the self-serve dialog too, not only from the admin panel.
 *
 * There is deliberately NO supervised-minor or guardian code here. #368's
 * owner decision (2026-08-29, see `deleteMyAccount.ts`'s docstring) is that a
 * supervised minor MAY delete their own account without a guardian veto --
 * refusing would be a GDPR erasure request denied. The guardian is notified
 * AFTER the erasure completes, not asked to approve it beforehand, so
 * `deleteMyAccount` has no error branch a minor's client could ever receive
 * for being supervised.
 *
 * The callable's own two guards (a stale session past the re-auth window;
 * the wrong confirmation token) throw plain `failed-precondition` /
 * `invalid-argument` with NO `details.code` at all -- read those off
 * `callableErrorCode` instead.
 */
export type AccountDeleteErrorCode = 'admin/last-admin';

export function accountDeleteErrorCode(err: unknown): AccountDeleteErrorCode | null {
  const details = (err as { details?: { code?: unknown } } | null)?.details;
  const code = details?.code;
  return code === 'admin/last-admin' ? code : null;
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
