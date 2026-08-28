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
 * Used by exportUserData (export references where the user is the provider)
 * and deleteUser (erase them). The submitter side is keyed separately by
 * `submittedByUserId` / `submittedByFamilyId`, which are shared across apps.
 */
export const REFERENCE_PROVIDER_KEYS = [
  'babysitterUserId',
  'tutorUserId',
  'doerUserId',
] as const;
