/**
 * One-shot backfill — lift nested shared-identity fields to the users/{uid}
 * ROOT (issue #203 / PR #205 owner decisions: one account across the sync
 * apps, not per-app copies).
 *
 * Fields: ejemEmail, contactEmail, contactPhone, whatsapp. For each users doc
 * and each field: if the ROOT KEY IS ABSENT and a nested copy
 * (profiles.babysitter.* / profiles.tutor.*) holds a non-empty STRING, that
 * value is copied to the root. Two consequences worth stating plainly:
 *   - an explicit root null/'' is a user CLEAR (root presence is
 *     authoritative for contact) and is never lifted over — the deletion
 *     stands;
 *   - a non-string nested value is invisible here exactly as it is to
 *     shared-core's getContact, so the lifted root always equals what the
 *     readers already resolved.
 * Root-present fields are NEVER touched, so re-running is a no-op.
 *
 * TIEBREAK: when the babysitter and tutor copies both exist and disagree, the
 * BABYSITTER copy wins — sit predates study, so sit-origin values are the
 * older, first-verified ones; every cross-app enrollment since copied sit ->
 * study, making the babysitter copy the origin of the pair. (This matches
 * the read helpers' fallback order in shared-core getEjemEmail/getContact.)
 *
 * CONTESTED fields (both nested copies non-empty and disagreeing) are
 * flagged in every run; under --apply the affected DOCS are skipped and the
 * run exits 2 unless --force-contested is passed — review, then force.
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

/** A nested value the read helpers would actually resolve: shared-core's
 *  nonEmpty() takes strings only, so a non-string (junk written by some
 *  legacy path) is INVISIBLE to getContact and must be invisible here too —
 *  otherwise junk in one profile shadows a valid value in the other, and the
 *  lifted root would disagree with what getContact resolved pre-backfill
 *  (PR #206 review). */
function nestedValue(value) {
  return typeof value === 'string' && value !== '' ? value : undefined;
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
    // Only lift when the root key is ABSENT. An explicit null/'' at the root
    // is a user CLEAR (getContact treats root presence as authoritative), so
    // resurrecting the nested copy over it would undo a deletion of personal
    // contact data (PR #206 review). ejemEmail is server-owned and never
    // cleared, so absence is its only empty state anyway.
    if (data?.[field] !== undefined) continue;
    const bsVal = nestedValue(babysitter[field]);
    const tuVal = nestedValue(tutor[field]);
    if (bsVal !== undefined && tuVal !== undefined && bsVal !== tuVal) {
      contested.push({ field, babysitter: bsVal, tutor: tuVal });
    }
    // Babysitter copy wins over tutor copy (see header tiebreak).
    const nested = bsVal !== undefined ? bsVal : tuVal;
    if (nested !== undefined) patch[field] = nested;
  }
  // INVARIANT: a field only lands in `contested` when both nested copies hold
  // values, in which case the tiebreak also puts one in `patch` — so a
  // non-null return always carries a NON-EMPTY patch. Callers rely on that;
  // there is no "contested but nothing to write" case (PR #206 review).
  return Object.keys(patch).length > 0 ? { patch, contested } : null;
}

module.exports = { computeRootPatch, nestedValue, SHARED_FIELDS };

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
  const forceContested = process.argv.includes('--force-contested');

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
  let contestedFields = 0;
  let skippedContested = 0;

  for (const userDoc of usersSnap.docs) {
    const result = computeRootPatch(userDoc.data());
    if (!result) {
      unchanged += 1;
      continue;
    }
    for (const c of result.contested) {
      contestedFields += 1;
      console.log(
        `  CONTESTED users/${userDoc.id} ${c.field}: babysitter='${c.babysitter}' vs tutor='${c.tutor}' — tiebreak keeps the babysitter copy; the tutor copy may be a newer study edit.`,
      );
    }
    const fields = Object.keys(result.patch).join(', ');
    // Structural review gate (PR #206 review): a doc with any contested
    // field is SKIPPED unless --force-contested is passed — the tiebreak must
    // never silently canonicalize a possibly-newer study edit, and root
    // ejemEmail is client-immutable once written, so the only correction is
    // another Admin-SDK run. The condition is deliberately NOT gated on
    // `apply`: the dry run is the artifact the operator reviews, so it must
    // predict what --apply does rather than promising a write that will be
    // skipped. Uncontested docs still apply normally.
    if (result.contested.length > 0 && !forceContested) {
      console.log(`  SKIP  users/${userDoc.id} — contested; re-run with --force-contested after review`);
      skippedContested += 1;
      continue;
    }
    if (apply) {
      await userDoc.ref.update(result.patch);
      console.log(`  WRITE users/${userDoc.id} — set root ${fields}`);
    } else {
      console.log(`  WOULD users/${userDoc.id} — set root ${fields}`);
    }
    updated += 1;
  }

  console.log(`\nDone. ${apply ? 'Wrote' : 'Would write'} ${updated} doc(s); ${unchanged} already canonical/no source; ${contestedFields} CONTESTED field(s) flagged; ${skippedContested} doc(s) skipped as contested.`);
  if (skippedContested > 0 && !apply) {
    console.log(
      `\nNOTE: ${skippedContested} contested doc(s) would be SKIPPED by --apply. Review the CONTESTED lines above, then re-run with --apply --force-contested to include them.`,
    );
  }
  if (apply && skippedContested > 0) {
    console.error(
      `\nATTENTION: ${skippedContested} contested doc(s) were NOT written. Review the CONTESTED lines, then re-run with --force-contested to apply the babysitter tiebreak to them.`,
    );
    process.exit(2);
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
