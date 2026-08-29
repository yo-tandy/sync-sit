import { ENDORSEMENT_SUBJECT_FIELD } from '@ejm/shared-core';

/**
 * Provider-side uid keys on docs in the shared `references` collection
 * (issue #295). A reference/endorsement names exactly one provider, keyed by
 * an app-specific field:
 *
 *   - `babysitterUserId` — sit references (ReferenceDoc, shared-core);
 *   - `tutorUserId`      — study endorsements (TutorEndorsementDoc, study-core);
 *   - `doerUserId`       — do endorsements (DoerEndorsementDoc, ships with
 *                          sync-do PR11). Listing it here is zero-cost today
 *                          (a query on a field no doc carries matches nothing)
 *                          and makes GDPR export/erasure cover doers
 *                          automatically the moment the field exists.
 *
 * DERIVED, not restated (issue #280): this list and the cross-app rendering
 * registry are the same set of fields, and they had drifted apart into two
 * hand-maintained copies. The failure modes are not symmetric — forgetting the
 * rendering registry costs a missing badge, forgetting THIS one leaves a
 * provider's endorsements alive after their account is erased, silently. So it
 * derives from `ENDORSEMENT_SUBJECT_FIELD` in shared-core (firebase-free
 * precisely so admin-SDK code can consume it) and a fourth product becomes one
 * registry entry for erasure as well as for rendering.
 *
 * Frozen, like its source: `Object.values` hands back a fresh MUTABLE array,
 * and by the asymmetry above this is the list where a stray mutation fails
 * silently — a deleted provider's endorsements simply survive. Compile-time
 * `readonly` is erased and would not have stopped it.
 *
 * Used by exportUserData (export references where the user is the provider)
 * and deleteUser (erase them). The submitter side is keyed separately by
 * `submittedByUserId` / `submittedByFamilyId`, which are shared across apps.
 */
export const REFERENCE_PROVIDER_KEYS = Object.freeze(
  Object.values(ENDORSEMENT_SUBJECT_FIELD),
);
