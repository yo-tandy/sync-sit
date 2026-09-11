import { ReferenceStatus } from './statuses.js';

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
 * The ONLY `references` status `endorsementResubmissionState` treats as a
 * decline — everything else in `ReferenceStatus` blocks a new request as
 * LIVE. `submitTutorEndorsement`/`submitEndorsement`'s own respond callables
 * (`respondToTutorEndorsement.ts` / `respondToEndorsement.ts`) write only
 * `private` (pending) → `approved` (accept) or `removed` (decline), so in
 * today's write paths `pending`/`published` never appear on a study/do doc.
 * But `checkEndorsementResubmission`'s query carries no `type` or `status`
 * filter — it reads the full history for a (family, recipient) pair,
 * including anything an admin backfill, migration, or future feature ever
 * writes there — so this fails CLOSED: derived as "every status except the
 * one genuinely negative one", not a hand-picked allowlist that a new/legacy
 * status could silently fall through as "declined" (the bug this list was
 * corrected to avoid — a `published` or `pending` doc must never be treated
 * as re-requestable after 30 days).
 */
const NEGATIVE_ENDORSEMENT_STATUSES = Object.freeze([
  ReferenceStatus.REMOVED,
] as const) satisfies readonly ReferenceStatus[];

/**
 * `references` statuses that block a NEW endorsement request outright for a
 * (family, recipient) pair — every `ReferenceStatus` value except
 * {@link NEGATIVE_ENDORSEMENT_STATUSES}, derived from the enum rather than
 * re-typed so a status added to `ReferenceStatus` later is live by default
 * (the fail-closed direction) instead of silently falling into "declined".
 *
 * Overlaps but is NOT identical to `PUBLIC_ENDORSEMENT_STATUSES`
 * (crossAppEndorsements.ts): that set is what a STRANGER may READ (approved,
 * published); this set is what blocks a new WRITE, and also includes
 * `pending`/`private` — a request awaiting response is live for dedup
 * purposes even though it is not yet publicly readable.
 */
export const LIVE_ENDORSEMENT_STATUSES = Object.freeze(
  (Object.values(ReferenceStatus) as ReferenceStatus[]).filter(
    (status) => !(NEGATIVE_ENDORSEMENT_STATUSES as readonly string[]).includes(status),
  ),
) satisfies readonly ReferenceStatus[];

/**
 * The HttpsError `details.code` a cool-down refusal carries (the
 * `ageGateErrorCode` / `age/under-15` convention in
 * `shared-ui/utils/callableErrors.ts`, applied to this refusal). `details`
 * also carries `retryAt` (an ISO string) — the client's
 * `endorsementCooldownDetails` reads both.
 */
export const ENDORSEMENT_COOLDOWN_ERROR_CODE = 'endorsement/cooldown';
