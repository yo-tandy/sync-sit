import {
  ENDORSEMENT_RESUBMISSION_COOLDOWN_DAYS,
  LIVE_ENDORSEMENT_STATUSES,
} from '../constants/endorsements.js';

/** One day, in milliseconds — the unit the cool-down constant is stated in. */
const DAY_MS = 24 * 60 * 60 * 1000;

export const ENDORSEMENT_RESUBMISSION_COOLDOWN_MS =
  ENDORSEMENT_RESUBMISSION_COOLDOWN_DAYS * DAY_MS;

/**
 * The minimum shape `endorsementResubmissionState` needs from an EXISTING
 * `references` doc for a (family, recipient) pair.
 *
 * `updatedAtMs`, not `declinedAt`: neither `TutorEndorsementDoc` (study-core)
 * nor `DoerEndorsementDoc` (do-core) has ever carried a `declinedAt` field —
 * `respondToTutorEndorsement.ts` and `respondToEndorsement.ts` both write
 * only `{ status: 'removed', updatedAt }` on a decline (see their `else`
 * branch). This repo's absent-vs-null discipline says an always-empty field
 * does not get minted just because a feature COULD have used it, so this
 * anchors the cool-down on the field the decline path actually writes,
 * `updatedAt`, rather than adding a `declinedAt` no write path would ever
 * populate.
 */
export interface ExistingEndorsementForResubmission {
  status: string;
  updatedAtMs: number;
}

export type EndorsementResubmissionState =
  | { allowed: true }
  | { allowed: false; reason: 'live' }
  | { allowed: false; reason: 'cooldown'; retryAt: Date };

/**
 * Issue #356, option (b): dedup a family's endorsement request against a
 * recipient only on LIVE statuses, so a decline is not final — but a family
 * may not simply resubmit immediately after one. Pure and Firebase-free
 * (the `crossAppEndorsements.ts` convention) so both callables' Firestore
 * plumbing — a plain query for study, a transaction read for do — can wrap
 * it identically; see `checkEndorsementResubmission` in
 * `@ejm/shared-functions`, which both call.
 *
 * `existingDocs` is every doc already matching the (appSource, recipient,
 * family) equality filters — NOT just one. Multiple can accumulate over time
 * (decline, wait out the cool-down, submit again, decline again, ...), and
 * only one can ever be live at once (a new submission is refused while one
 * is), so:
 *
 *   - any LIVE doc present (`LIVE_ENDORSEMENT_STATUSES` — every
 *     `ReferenceStatus` except `removed`) blocks outright, regardless of any
 *     declined docs alongside it;
 *   - otherwise every doc is a decline, and the MOST RECENT one's
 *     `updatedAtMs` anchors the cool-down — an old decline does not matter
 *     once a newer one exists.
 */
export function endorsementResubmissionState(
  existingDocs: readonly ExistingEndorsementForResubmission[],
  now: Date,
): EndorsementResubmissionState {
  const isLive = (status: string): boolean =>
    (LIVE_ENDORSEMENT_STATUSES as readonly string[]).includes(status);

  if (existingDocs.some((doc) => isLive(doc.status))) {
    return { allowed: false, reason: 'live' };
  }

  let mostRecentDeclineMs: number | null = null;
  for (const doc of existingDocs) {
    if (mostRecentDeclineMs === null || doc.updatedAtMs > mostRecentDeclineMs) {
      mostRecentDeclineMs = doc.updatedAtMs;
    }
  }
  if (mostRecentDeclineMs === null) {
    return { allowed: true };
  }

  const retryAtMs = mostRecentDeclineMs + ENDORSEMENT_RESUBMISSION_COOLDOWN_MS;
  if (now.getTime() >= retryAtMs) {
    return { allowed: true };
  }
  return { allowed: false, reason: 'cooldown', retryAt: new Date(retryAtMs) };
}
