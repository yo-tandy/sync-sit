/**
 * One-shot backfill — lift nested shared-identity fields to the users/{uid}
 * ROOT (issue #203 / PR #205 owner decisions: one account across the sync
 * apps, not per-app copies).
 *
 * Fields: ejemEmail, contactEmail, contactPhone, whatsapp. For each users doc
 * and each field: if the ROOT value is empty (absent/null/'') and a nested
 * copy (profiles.babysitter.* / profiles.tutor.*) has a non-empty value, the
 * nested value is copied to the root. Root-populated fields are NEVER
 * touched, so re-running is a no-op (idempotent).
 *
 * TIEBREAK: when the babysitter and tutor copies both exist and disagree, the
 * BABYSITTER copy wins — sit predates study, so sit-origin values are the
 * older, first-verified ones; every cross-app enrollment since copied sit ->
 * study, making the babysitter copy the origin of the pair. (This matches
 * the read helpers' fallback order in shared-core getEjemEmail/getContact.)
 *
 * DRY-RUN BY DEFAULT: prints what would change and writes nothing. Pass
 * --apply (or APPLY=1) to actually write; DRY_RUN=1 forces a dry-run even if
 * apply is requested.
 *
 * Run from the repo root:
 *   node scripts/backfill-shared-identity.cjs [--project <id>]           # dry-run
 *   node scripts/backfill-shared-identity.cjs --apply --project <id>     # write
 *
 * Auth: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or an
 * authenticated gcloud env). To test against the emulator, export
 * FIRESTORE_EMULATOR_HOST first.
 *
 * DEPLOY STEP: run ONCE against prod right after the shared-identity release
 * ships — dry-run first, review the output, then --apply. Until it runs,
 * every reader still resolves through the root ?? nested fallback, so
 * nothing breaks; the backfill just makes the canonical root real for
 * pre-change docs.
 */

const SHARED_FIELDS = ['ejemEmail', 'contactEmail', 'contactPhone', 'whatsapp'];

/** Empty means absent/null/'' — same emptiness rule as fillBaseFields and the
 *  shared-core helpers. */
function isEmpty(value) {
  return value === undefined || value === null || value === '';
}

/**
 * Compute the root update for one users doc, or null when nothing to do.
 * Pure — unit-testable without the admin SDK.
 */
function computeRootPatch(data) {
  const babysitter = data?.profiles?.babysitter || {};
  const tutor = data?.profiles?.tutor || {};
  const patch = {};
  // Fields where BOTH nested copies are non-empty and DISAGREE: the lift still
  // applies the babysitter tiebreak, but the operator must see these — the
  // tutor copy may hold a NEWER pre-release study edit that the tiebreak
  // discards (PR #206 review). The dry run prints them as CONTESTED; review
  // that (small) set before --apply.
  const contested = [];
  for (const field of SHARED_FIELDS) {
    if (!isEmpty(data?.[field])) continue; // root already canonical — never touch
    const bsVal = !isEmpty(babysitter[field]) ? babysitter[field] : undefined;
    const tuVal = !isEmpty(tutor[field]) ? tutor[field] : undefined;
    if (bsVal !== undefined && tuVal !== undefined && bsVal !== tuVal) {
      contested.push({ field, babysitter: bsVal, tutor: tuVal });
    }
    // Babysitter copy wins over tutor copy (see header tiebreak).
    const nested = bsVal !== undefined ? bsVal : tuVal;
    if (typeof nested === 'string' && nested !== '') patch[field] = nested;
  }
  return Object.keys(patch).length > 0 || contested.length > 0
    ? { patch: Object.keys(patch).length > 0 ? patch : null, contested }
    : null;
}

module.exports = { computeRootPatch, isEmpty, SHARED_FIELDS };

async function main() {
  // firebase-admin is not installed at the repo root; resolve it through the
  // functions workspace (same pattern as backfill-family-postcode.cjs). Lazy
  // so unit tests can import the pure helpers above without the admin SDK.
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

  console.log(`\nBackfill shared identity (root ejemEmail + contact) — mode: ${apply ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(`  Target: EMULATOR at ${process.env.FIRESTORE_EMULATOR_HOST}`);
  }

  const usersSnap = await db.collection('users').get();
  console.log(`  Scanned ${usersSnap.size} user doc(s).\n`);

  let updated = 0;
  let unchanged = 0;
  let contestedDocs = 0;

  for (const userDoc of usersSnap.docs) {
    const result = computeRootPatch(userDoc.data());
    if (!result || (!result.patch && result.contested.length === 0)) {
      unchanged += 1;
      continue;
    }
    for (const c of result.contested) {
      contestedDocs += 1;
      console.log(
        `  CONTESTED users/${userDoc.id} ${c.field}: babysitter='${c.babysitter}' vs tutor='${c.tutor}' — tiebreak keeps the babysitter copy; the tutor copy may be a newer study edit. Review before --apply.`,
      );
    }
    if (!result.patch) { unchanged += 1; continue; }
    const fields = Object.keys(result.patch).join(', ');
    if (apply) {
      await userDoc.ref.update(result.patch);
      console.log(`  WRITE users/${userDoc.id} — set root ${fields}`);
    } else {
      console.log(`  WOULD users/${userDoc.id} — set root ${fields}`);
    }
    updated += 1;
  }

  console.log(`\nDone. ${apply ? 'Wrote' : 'Would write'} ${updated} doc(s); ${unchanged} already canonical/no source; ${contestedDocs} CONTESTED field(s) flagged above.`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
