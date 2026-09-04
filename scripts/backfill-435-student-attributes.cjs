/**
 * One-shot backfill — lift nested student-identity fields to the users/{uid}
 * ROOT (issue #435 milestone, PR1 owner decisions: classLevel/gender promoted
 * from `profiles.babysitter.classLevel/gender` (sit) and
 * `profiles.tutor.classLevel/gender` (study) to root `User` fields).
 *
 * Fields: classLevel, gender. For each users doc and each field: if the ROOT
 * KEY IS ABSENT and a nested copy (profiles.babysitter.* / profiles.tutor.*)
 * holds a non-empty STRING, that value is copied to the root. Root-present
 * fields are NEVER touched, so re-running is a no-op (idempotent) — this
 * mirrors backfill-shared-identity.cjs's contract, with ONE deliberate
 * difference in the tiebreak (see below).
 *
 * TIEBREAK: when the babysitter and tutor copies both exist and DISAGREE, the
 * BABYSITTER copy wins — same rationale as backfill-shared-identity.cjs (sit
 * predates study; every cross-app enrollment historically copied sit ->
 * study, making the babysitter copy the origin of the pair). This matches
 * shared-core's getClassLevel/getGender fallback order (root ?? babysitter ??
 * tutor).
 *
 * UNLIKE backfill-shared-identity.cjs, a conflict here does NOT skip the doc
 * under --apply: classLevel/gender are lower-stakes categorical fields (not
 * an email address or an immutable identity claim), and the milestone plan
 * explicitly calls for "prefer the babysitter value and log a warning — a
 * data quality signal worth surfacing, not silently resolving" rather than a
 * review gate. Every run — dry or applied — prints a CONFLICT line for each
 * disagreement found, and the babysitter-preferring patch is written (or
 * would be) regardless.
 *
 * A nested value that isn't a non-empty STRING (absent, null, '', or junk of
 * another type) is treated as no value — same as shared-core's
 * getClassLevel/getGender resolvers (`nonEmpty`), so the backfill's notion of
 * "has a value" never disagrees with what the readers already resolve.
 * Notably: sit's StepProfile.tsx writes `gender: gender || null` when the
 * question was answered with no selection — that null is NOT lifted (it
 * isn't a value), matching how getGender treats it as absent too.
 *
 * DRY-RUN BY DEFAULT: prints what would change and writes nothing. Pass
 * --apply (or APPLY=1) to actually write; DRY_RUN=1 forces a dry-run even if
 * apply is requested.
 *
 * Run from the repo root:
 *   node scripts/backfill-435-student-attributes.cjs [--project <id>]        # dry-run
 *   node scripts/backfill-435-student-attributes.cjs --apply --project <id>  # write
 *
 * Auth: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or an
 * authenticated gcloud env). To test against the emulator, export
 * FIRESTORE_EMULATOR_HOST first.
 *
 * DEPLOY STEP: run ONCE against prod right after the enrollment-root-fields
 * release ships — dry-run first, review the CONFLICT lines, then --apply.
 * Until it runs, every reader still resolves through the root ?? nested
 * fallback (getClassLevel/getGender), so nothing breaks; the backfill just
 * makes the canonical root real for pre-existing docs.
 */

const STUDENT_FIELDS = ['classLevel', 'gender'];

/** A nested value the read helpers would actually resolve: shared-core's
 *  getClassLevel/getGender use nonEmpty() (strings only), so a non-string or
 *  empty value is INVISIBLE to them and must be invisible here too —
 *  otherwise junk/null in one profile would shadow a valid value in the
 *  other, or the backfill would "have a value" when the readers see none. */
function nestedValue(value) {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Compute the root update for one users doc, or null when nothing to do.
 * Pure — unit-testable without the admin SDK.
 *
 * Returns { patch, conflicts } where `conflicts` lists every field where both
 * nested copies disagreed (informational only — the patch already applies
 * the babysitter tiebreak for those fields; the caller decides how loudly to
 * report them, but never skips the write because of one).
 */
function computeRootPatch(data) {
  const babysitter = data?.profiles?.babysitter || {};
  const tutor = data?.profiles?.tutor || {};
  const patch = {};
  const conflicts = [];
  for (const field of STUDENT_FIELDS) {
    // Only lift when the root key is ABSENT. classLevel/gender are not
    // set-once/clearable like the shared-identity contact trio, but the same
    // "root presence wins" rule still applies here: a doc that already has a
    // root value (however it got there — the callables, a prior backfill
    // run, or an owner edit) must never be overwritten by a stale nested
    // copy.
    if (data?.[field] !== undefined) continue;
    const bsVal = nestedValue(babysitter[field]);
    const tuVal = nestedValue(tutor[field]);
    if (bsVal !== undefined && tuVal !== undefined && bsVal !== tuVal) {
      conflicts.push({ field, babysitter: bsVal, tutor: tuVal });
    }
    // Babysitter copy wins over tutor copy when both exist (see header
    // tiebreak) — applied regardless of whether this field was flagged
    // above; a conflict is a warning, never a reason to skip the write.
    const resolved = bsVal !== undefined ? bsVal : tuVal;
    if (resolved !== undefined) patch[field] = resolved;
  }
  // INVARIANT: a field only lands in `conflicts` when both nested copies hold
  // values, in which case the tiebreak also puts one in `patch` — so a
  // non-null return with conflicts always carries a patch entry for each
  // conflicted field too. Mirrors backfill-shared-identity.cjs's invariant.
  return Object.keys(patch).length > 0 ? { patch, conflicts } : null;
}

module.exports = { computeRootPatch, nestedValue, STUDENT_FIELDS };

async function main() {
  // firebase-admin is not installed at the repo root; resolve it through the
  // functions workspace (same pattern as backfill-family-postcode.cjs /
  // backfill-shared-identity.cjs). Lazy so unit tests can import the pure
  // helpers above without the admin SDK.
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

  console.log(`\nBackfill student attributes (root classLevel + gender) — mode: ${apply ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(`  Target: EMULATOR at ${process.env.FIRESTORE_EMULATOR_HOST}`);
  }

  const usersSnap = await db.collection('users').get();
  console.log(`  Scanned ${usersSnap.size} user doc(s).\n`);

  let updated = 0;
  let unchanged = 0;
  let conflictedFields = 0;

  for (const userDoc of usersSnap.docs) {
    const result = computeRootPatch(userDoc.data());
    if (!result) {
      unchanged += 1;
      continue;
    }
    for (const c of result.conflicts) {
      conflictedFields += 1;
      console.log(
        `  CONFLICT users/${userDoc.id} ${c.field}: babysitter='${c.babysitter}' vs tutor='${c.tutor}' — writing the babysitter value (tiebreak); review if the tutor copy is the newer one.`,
      );
    }
    const fields = Object.keys(result.patch).join(', ');
    if (apply) {
      await userDoc.ref.update(result.patch);
      console.log(`  WRITE users/${userDoc.id} — set root ${fields}`);
    } else {
      console.log(`  WOULD users/${userDoc.id} — set root ${fields}`);
    }
    updated += 1;
  }

  console.log(`\nDone. ${apply ? 'Wrote' : 'Would write'} ${updated} doc(s); ${unchanged} already canonical/no source; ${conflictedFields} CONFLICT(s) logged (babysitter value applied to each).`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
