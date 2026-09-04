/**
 * One-shot backfill — compute and write `profiles.{babysitter,tutor}.
 * effectiveSearchable` for every EXISTING provider profile (issue #435 PR2,
 * "Effective-searchability").
 *
 * Context: `onUserWrittenRecomputeSearchable` (apps/functions) only fires on
 * a WRITE to a users/{uid} doc from the moment it deploys onward. Every
 * babysitter/tutor profile that already existed before that deploy has no
 * `effectiveSearchable` field at all — and `searchBabysitters`/
 * `searchTutors`/`lookupBabysitter` now filter their queries on
 * `effectiveSearchable == true`, so without this backfill every pre-existing
 * searchable provider would silently vanish from search the moment the new
 * query filter ships. This script closes that gap once, so the query-filter
 * change and the backfill are meant to ship in the SAME release.
 *
 * FIELDS FOLDED IN (mirrors computeEffectiveSearchable, packages/shared-core/
 * src/utils/effectiveSearchable.ts, exactly — reimplemented here in plain JS
 * rather than imported, matching this repo's other backfill scripts: a
 * workspace package's CJS `dist/` build is not guaranteed to exist at backfill
 * time, so the comparison below must stay hand-verified against the
 * shared-core source, not just asserted):
 *   effectiveSearchable = (status === 'active')
 *                       && (profile.searchable === true)
 *                       && (profile.enrollmentComplete === true)
 *
 * IDEMPOTENT: only writes a provider's `effectiveSearchable` when the freshly
 * computed value DIFFERS from what is already stored (absent counts as
 * "different" from either true or false, so a doc the trigger has never
 * touched always gets its first write). Re-running after every provider has
 * been touched (by this script or by the trigger) is therefore a no-op —
 * same contract as backfill-435-student-attributes.cjs and
 * backfill-shared-identity.cjs.
 *
 * DRY-RUN BY DEFAULT: prints what would change and writes nothing. Pass
 * --apply (or APPLY=1) to actually write; DRY_RUN=1 forces a dry-run even if
 * apply is requested.
 *
 * Run from the repo root:
 *   node scripts/backfill-435-effective-searchable.cjs [--project <id>]        # dry-run
 *   node scripts/backfill-435-effective-searchable.cjs --apply --project <id>  # write
 *
 * Auth: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or an
 * authenticated gcloud env). To test against the emulator, export
 * FIRESTORE_EMULATOR_HOST first.
 *
 * DEPLOY STEP: run ONCE against prod right after (or as part of) the same
 * release that ships onUserWrittenRecomputeSearchable and the
 * effectiveSearchable query-filter swap in searchBabysitters/searchTutors/
 * lookupBabysitter — dry-run first, review the WOULD lines, then --apply.
 * Until it runs, any pre-existing provider whose write-trigger has not yet
 * fired for any other reason (a profile edit, a searchable toggle, ...) stays
 * invisible to search even though every real-world input says it should be
 * visible.
 */

const PROVIDER_KEYS = ['babysitter', 'tutor'];

/** The exact computeEffectiveSearchable fold-in (shared-core) — see the
 *  header note on why this is a hand-verified copy, not an import. */
function computeEffective(status, profile) {
  return status === 'active' && profile?.searchable === true && profile?.enrollmentComplete === true;
}

/**
 * Compute the `profiles.{key}.effectiveSearchable` patch for one users doc,
 * or null when every provider profile it carries is already converged. Pure
 * — unit-testable without the admin SDK.
 */
function computeUserPatch(data) {
  const patch = {};
  for (const key of PROVIDER_KEYS) {
    const profile = data?.profiles?.[key];
    if (!profile) continue; // no such provider profile on this doc
    const computed = computeEffective(data?.status, profile);
    if (profile.effectiveSearchable === computed) continue; // already converged
    patch[`profiles.${key}.effectiveSearchable`] = computed;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

module.exports = { computeUserPatch, computeEffective, PROVIDER_KEYS };

async function main() {
  // firebase-admin is not installed at the repo root; resolve it through the
  // functions workspace (same pattern as backfill-family-postcode.cjs /
  // backfill-shared-identity.cjs / backfill-435-student-attributes.cjs).
  // Lazy so unit tests can import the pure helpers above without the admin
  // SDK.
  const { createRequire } = require('module');
  const path = require('path');
  const fnRequire = createRequire(path.resolve(__dirname, '../apps/functions/package.json'));
  const { initializeApp } = fnRequire('firebase-admin/app');
  const { getFirestore } = fnRequire('firebase-admin/firestore');

  const argv = process.argv.slice(2);
  const projectFlagIdx = argv.indexOf('--project');
  const projectId =
    projectFlagIdx !== -1 ? argv[projectFlagIdx + 1] : process.env.GCLOUD_PROJECT || undefined;
  const apply =
    (argv.includes('--apply') || process.env.APPLY === '1') && process.env.DRY_RUN !== '1';

  const app = initializeApp(projectId ? { projectId } : undefined);
  const db = getFirestore(app);

  console.log(`\nBackfill effectiveSearchable (profiles.babysitter/tutor) — mode: ${apply ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(`  Target: EMULATOR at ${process.env.FIRESTORE_EMULATOR_HOST}`);
  }

  const usersSnap = await db.collection('users').get();
  console.log(`  Scanned ${usersSnap.size} user doc(s).\n`);

  let updated = 0;
  let unchanged = 0;

  for (const userDoc of usersSnap.docs) {
    const patch = computeUserPatch(userDoc.data());
    if (!patch) {
      unchanged += 1;
      continue;
    }
    const fields = Object.entries(patch)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    if (apply) {
      await userDoc.ref.update(patch);
      console.log(`  WRITE users/${userDoc.id} — ${fields}`);
    } else {
      console.log(`  WOULD users/${userDoc.id} — ${fields}`);
    }
    updated += 1;
  }

  console.log(`\nDone. ${apply ? 'Wrote' : 'Would write'} ${updated} doc(s); ${unchanged} already converged/no provider profile.`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
