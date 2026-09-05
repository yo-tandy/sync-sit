/**
 * The user shape `computeEffectiveSearchable` needs. Typed as `status?:
 * unknown` (rather than `Pick<User, 'status'>`, i.e. `{ status: AccountStatus
 * }`) deliberately: every real caller passes either a typed `User`/`StudyUser`
 * or a raw Firestore `DocumentData` (an index-signature type, which does NOT
 * structurally satisfy a required named property in TypeScript) — `status`
 * only needs an `=== 'active'` comparison, which is safe against any runtime
 * value, so the parameter type should not force every caller into a cast.
 */
export interface EffectiveSearchabilityUser {
  status?: unknown;
}

/**
 * The provider-profile shape `computeEffectiveSearchable` needs. Both
 * `BabysitterProfile` (sit-core) and `TutorProfile` (study-core) satisfy this
 * structurally — each extends `ProfileBase` (which types `enrollmentComplete`
 * as a required `boolean`) and declares its own `searchable?: boolean`
 * toggle. `enrollmentComplete` is typed optional HERE (rather than
 * `Pick<ProfileBase, 'enrollmentComplete'>`, which would make it required and
 * reject a legacy/partial doc read off Firestore) — this function already
 * treats an absent value as "not complete" (`undefined === true` is
 * `false`), so nothing is lost, and callers reading real, possibly-stale
 * Firestore data are not forced to assert a field they cannot guarantee is
 * there. Kept minimal and local to shared-core (which must never import from
 * a leaf package) rather than importing either concrete profile type.
 */
export interface EffectiveSearchabilityProfile {
  searchable?: boolean;
  enrollmentComplete?: boolean;
}

/**
 * One function, one source of truth for "should this provider profile appear
 * in search at all" (issue #435 PR2 — "Effective-searchability").
 *
 * Folds in every static reason a babysitter/tutor profile should be hidden
 * from search, which today's `searchBabysitters`/`searchTutors` query filters
 * (and a couple of other read sites) checked as separate, hand-maintained
 * conditions:
 *  - `user.status === 'active'` — the hard ban/deletion gate.
 *  - `profile.searchable === true` — the provider's own visibility toggle.
 *    Semantics are UNCHANGED: still user-controlled (or guardian-controlled
 *    via `guardianSetChildSearchable`), this function only reads it.
 *  - `profile.enrollmentComplete === true` — the provider actually finished
 *    enrollment. `searchBabysitters`/`lookupBabysitter` did not check this
 *    before this PR; `searchTutors` did, as a separate query clause.
 *
 * Deliberately EXCLUDED (see the issue #435 milestone plan, Design §3): a
 * "zero availability" check. That reason for hiding a provider is
 * query-shape-dependent — it has to match a specific REQUESTED date/time
 * slot, not a static, always-the-same-answer emptiness check — so it isn't a
 * boolean this function could fold in without a different design. It stays
 * exactly where it already lives: `searchBabysitters.ts`'s per-query schedule
 * check, left untouched by this PR.
 *
 * Pure — no I/O, no Firestore, no clock — so the write-trigger
 * (`onUserWrittenRecomputeSearchable`) and the one-time backfill script can
 * both call it and agree by construction, and it is trivially unit-testable
 * for every input combination.
 */
export function computeEffectiveSearchable(
  user: EffectiveSearchabilityUser | null | undefined,
  profile: EffectiveSearchabilityProfile | null | undefined,
): boolean {
  return (
    user?.status === 'active' &&
    profile?.searchable === true &&
    profile?.enrollmentComplete === true
  );
}
