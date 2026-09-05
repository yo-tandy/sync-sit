import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { computeEffectiveSearchable } from '@ejm/shared-core';
import type { User, EffectiveSearchabilityProfile } from '@ejm/shared-core';

/** The two provider-profile slots this trigger keeps `effectiveSearchable`
 *  in sync for. `doer` (sync-do) and `parent` are out of scope — neither has
 *  a search surface this field feeds. */
const PROVIDER_PROFILE_KEYS = ['babysitter', 'tutor'] as const;

/**
 * Denormalizes `computeEffectiveSearchable` (shared-core, issue #435 PR2)
 * onto `profiles.{babysitter,tutor}.effectiveSearchable` whenever any of its
 * three inputs changes on the `users/{uid}` doc: `status`, the profile's own
 * `searchable` toggle, or `enrollmentComplete`. `searchBabysitters` /
 * `searchTutors` / `lookupBabysitter` filter their queries on this field
 * instead of re-deriving the same boolean (as several separate,
 * hand-maintained `.where()` clauses) at every read.
 *
 * DEPLOYS ONCE, FROM THE SIT CODEBASE ('default' in firebase.json), AND
 * COVERS BOTH PROVIDER PROFILES. sit (apps/functions) and study
 * (apps/study-functions) are two Cloud Functions codebases deployed to the
 * SAME Firebase project / Firestore database, and both `profiles.babysitter`
 * and `profiles.tutor` live on the same `users/{uid}` doc — so a second copy
 * of this trigger deployed from study-functions would fire twice per write
 * (each writing/verifying the same fields) for no benefit. This mirrors the
 * existing precedent for a trigger that must cover both apps from one shared
 * collection: `mirrorNotificationToGuardians`
 * (apps/functions/src/guardian/onNotificationCreated.ts), which deploys once
 * from sit and explicitly covers study's + do's notification writers too.
 * Do NOT add a second registration of this function to study-functions.
 *
 * SELF-TRIGGER GUARD (onDocumentWritten fires on every write to the doc,
 * including this function's own): there is no reliable "was this write mine"
 * signal on a plain field update, so the guard is CONVERGENCE instead.
 * Recompute from `after` for each profile present; skip the write for a
 * profile whose stored `effectiveSearchable` already equals the freshly
 * computed value. Concretely: a real input change (e.g. `searchable` flips)
 * causes invocation N to compute a new value and write it; that write fires
 * invocation N+1, which recomputes from now-unchanged inputs, finds the
 * stored value already matches, and returns without writing — the chain
 * always terminates in exactly two invocations, never a loop. If NEITHER
 * profile needs a write, the whole `.update()` call is skipped, so a write to
 * an unrelated field (e.g. `lastLoginAt`) costs one no-op invocation and
 * nothing more.
 */
export const onUserWrittenRecomputeSearchable = onDocumentWritten(
  { document: 'users/{uid}', region: 'europe-west1' },
  async (event) => {
    const snapshot = event.data?.after;
    const after = snapshot?.data() as User | undefined;
    // Doc deleted (or, defensively, no readable data): nothing to recompute
    // or write.
    if (!snapshot || !after) return;

    const patch: Record<string, boolean> = {};
    for (const key of PROVIDER_PROFILE_KEYS) {
      const profile = after.profiles?.[key] as
        | (EffectiveSearchabilityProfile & { effectiveSearchable?: boolean })
        | undefined;
      // No profile of this kind on the doc at all: nothing to compute.
      if (!profile) continue;
      const computed = computeEffectiveSearchable(after, profile);
      if (profile.effectiveSearchable === computed) continue; // already converged
      patch[`profiles.${key}.effectiveSearchable`] = computed;
    }

    if (Object.keys(patch).length === 0) return;
    await snapshot.ref.update(patch);
  },
);
