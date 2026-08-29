import { HttpsError } from 'firebase-functions/v2/https';

/**
 * What a `verificationCodes/{email}` doc PROVES (issue #322).
 *
 * Two public callables write that one namespace:
 *   - `verifyParentEmail` — any domain, unauthenticated, no membership check.
 *   - `verifyEjmEmail`    — the address must be EJM-valid (domain + in-window
 *                           graduation year) or admin-preapproved.
 *
 * Because they share the doc id (the normalized address), "a valid code
 * exists for this address" proves only MAILBOX OWNERSHIP — never EJM
 * membership. Consumers that need the stronger fact used to infer it from
 * the namespace alone, which is what #322 reports: anyone with any mailbox
 * could mint a code via `verifyParentEmail` and satisfy an EJM-gated
 * enrollment. Each code doc now records what it proves, and each consumer
 * asserts the class it actually requires.
 *
 * WHY A FIELD AND NOT SEPARATE COLLECTIONS. Splitting the namespace was the
 * other candidate in #322 and is worse here, because the shared doc id is
 * load-bearing in three places:
 *   1. The per-address send cooldown (`sendCooldown.ts`) and the per-address
 *      daily send cap (`sendRateLimit.ts`) are deliberately SHARED across
 *      both callables — see verifyParentEmail.ts's "the budget is SHARED
 *      with verifyEjmEmail". Two collections give one address two
 *      independent cooldowns to burn.
 *   2. The 5-attempt brute-force limit is per doc. Two live docs per address
 *      = double the guessing budget against the same mailbox.
 *   3. The issue #148 account-exists decoy (`accountExistsNotice.ts`) works
 *      by writing where the consumer reads. Two namespaces mean two decoys
 *      to keep byte-shaped, or a re-opened enumeration oracle.
 * All three are widenings, and #322 explicitly forbids widening anything. A
 * field keeps one doc, one cooldown, one attempts counter, one decoy — and
 * moves the class from something a reader infers to something the writer
 * states.
 *
 * `issuer` is recorded alongside `identityClass` as provenance (which entry
 * point wrote the doc, for audit and debugging); `identityClass` is the
 * assertion, so a future issuer that also proves EJM membership stamps
 * `identityClass: 'ejm'` without every consumer having to learn its name.
 */
export type VerificationIdentityClass = 'mailbox' | 'ejm';

/** The callables allowed to issue codes. Provenance only — consumers assert
 *  on `identityClass`, never on this. */
export type VerificationCodeIssuer = 'verifyParentEmail' | 'verifyEjmEmail';

interface VerificationCodeStamp {
  issuer: VerificationCodeIssuer;
  identityClass: VerificationIdentityClass;
}

/** Stamp for `verifyParentEmail`: any-domain, so mailbox ownership only. */
export const PARENT_CODE_STAMP: VerificationCodeStamp = {
  issuer: 'verifyParentEmail',
  identityClass: 'mailbox',
};

/** Stamp for `verifyEjmEmail`: EJM-valid or admin-preapproved address. */
export const EJM_CODE_STAMP: VerificationCodeStamp = {
  issuer: 'verifyEjmEmail',
  identityClass: 'ejm',
};

/**
 * Which classes satisfy a requirement. `ejm` implies `mailbox` (an EJM code
 * was emailed to that address too), so a mailbox-class requirement accepts
 * both; an EJM requirement accepts only `ejm`.
 */
const SATISFYING_CLASSES: Record<VerificationIdentityClass, readonly VerificationIdentityClass[]> = {
  mailbox: ['mailbox', 'ejm'],
  ejm: ['ejm'],
};

/**
 * The class a stored code doc proves.
 *
 * TRANSITIONAL (remove with the compatibility note in the consumers): a doc
 * written before this change carries no `identityClass`, and nothing on it
 * says which callable wrote it — so it is read as the WEAKEST class,
 * `mailbox`. That fails CLOSED: an unstamped doc can still complete a parent
 * enrollment (which requires nothing more) but cannot complete an EJM-gated
 * one, so the pre-deploy window cannot be used to walk the very hole this
 * change closes. Inferring the class from the address instead (EJM-valid =>
 * `ejm`) was rejected: it re-introduces exactly the "the reader works out
 * the identity" reasoning #322 is about, and it would accept a code minted
 * through `verifyParentEmail` for an @ejm.org address, which skips
 * verifyEjmEmail's graduation-year window entirely.
 *
 * An unrecognized value fails closed the same way.
 */
export function codeIdentityClass(
  codeData: FirebaseFirestore.DocumentData | undefined,
): VerificationIdentityClass {
  return codeData?.identityClass === 'ejm' ? 'ejm' : 'mailbox';
}

/**
 * Throw unless the code doc proves at least `required`.
 *
 * Call it right after the existence check and BEFORE the code comparison: a
 * wrong-class code is rejected on what the doc is, not on what the caller
 * typed, so it must not burn one of the five brute-force attempts.
 *
 * Not an enumeration oracle in the issue #148 sense: the decoy written on
 * the existing-account path carries the stamp of the callable the prober
 * itself called, so a probe on an existing address and a probe on a fresh
 * one take the same branch here. Honest residual (same shape as the ones
 * accountExistsNotice.ts documents): while a victim has a live code in
 * flight AND the prober is inside the shared send cooldown (so its own
 * request wrote nothing), the class error vs. the invalid-code error tells
 * the prober WHICH signup flow that address is mid-way through. It reveals
 * no account existence, lasts at most the 10-minute code life, and closing
 * it would mean answering a wrong-class code with "invalid code" — which
 * burns a legitimate transitional caller's attempts and hides the real
 * cause.
 */
export function assertCodeIdentityClass(
  codeData: FirebaseFirestore.DocumentData | undefined,
  required: VerificationIdentityClass,
): void {
  if (SATISFYING_CLASSES[required].includes(codeIdentityClass(codeData))) {
    return;
  }
  // details.reason is the machine-readable marker clients may map to
  // translated copy; unmapped reasons surface the message as-is
  // (enrollmentErrorReason returns null), which this message is written for.
  throw new HttpsError(
    'failed-precondition',
    'This verification code cannot be used for this enrollment. Please request a new one.',
    { reason: 'code_identity_class' },
  );
}
