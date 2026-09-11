import type { ReferenceStatus } from './statuses.js';

/**
 * Endorsement resubmission (issue #356, option (b) from the triage comment):
 * dedup a family's endorsement request only on LIVE statuses, so they can ask
 * again after a decline — but not on every tap. A decline holds this window
 * before the family may resubmit.
 *
 * ONE number for `submitTutorEndorsement` (study) and `doSubmitEndorsement`
 * (do), read through `checkEndorsementResubmission` in
 * `@ejm/shared-functions` so the two callables cannot drift on it the way two
 * app-local copies could — the issue's stated concern.
 */
export const ENDORSEMENT_RESUBMISSION_COOLDOWN_DAYS = 30;

/**
 * `references` statuses that block a NEW endorsement request outright for a
 * (family, recipient) pair. `private` is the pending-response state
 * `submitTutorEndorsement`/`doSubmitEndorsement` write; `approved` is a
 * published one. `removed` (the recipient's own decline) is deliberately
 * excluded — that is exactly the case `endorsementResubmissionState` (in
 * `utils/endorsementResubmission.ts`) allows again, subject to the cool-down
 * above.
 *
 * A NARROWER set than `PUBLIC_ENDORSEMENT_STATUSES` (crossAppEndorsements.ts)
 * on purpose: that set is what a stranger may READ, which also includes
 * study/do's legacy `published`. This set is what blocks a new WRITE, and
 * `published` is not a status either endorsement callable's respond path
 * ever writes (see `respondToTutorEndorsement.ts` / `respondToEndorsement.ts`
 * — accept writes `approved`, decline writes `removed`), so including it here
 * would just be dead code pretending to guard against a doc shape that
 * cannot exist.
 */
export const LIVE_ENDORSEMENT_STATUSES = Object.freeze([
  'private',
  'approved',
] as const) satisfies readonly ReferenceStatus[];

/**
 * The HttpsError `details.code` a cool-down refusal carries (the
 * `ageGateErrorCode` / `age/under-15` convention in
 * `shared-ui/utils/callableErrors.ts`, applied to this refusal). `details`
 * also carries `retryAt` (an ISO string) — the client's
 * `endorsementCooldownDetails` reads both.
 */
export const ENDORSEMENT_COOLDOWN_ERROR_CODE = 'endorsement/cooldown';
