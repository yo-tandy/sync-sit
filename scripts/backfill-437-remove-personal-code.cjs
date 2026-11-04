/**
 * One-shot backfill — strip the retired `profiles.tutor.personalCode` field
 * from every tutor doc that still carries one (issue #437, "remove the
 * personal code in sync/study").
 *
 * Context: personalCode (issue #235) was replaced by name/email/phone lookup
 * (lookupTutor). The mint callable (getTutorPersonalCode) is gone and the
 * firestore.rules pin that made the field server-owned is gone with it, so
 * any tutor who minted a code before this release still has an orphaned,
 * inert value sitting on their profile. Nothing reads it anymore — this is
 * hygiene, not a blocker — but leaving it in place is a stale, unpinned field
 * a future client write could otherwise resurrect meaning for.
 *
 * IDEMPOTENT: only patches a doc whose tutor profile actually has a
 * `personalCode` key; re-running after every carrier has been cleaned is a
 * no-op.
 *
 * DRY-RUN BY DEFAULT: prints what would change and writes nothing. Pass
 * --apply (or APPLY=1) to actually write; DRY_RUN=1 forces a dry-run even if
 * apply is requested.
 *
 * Run from the repo root:
 *   node scripts/backfill-437-remove-personal-code.cjs [--project <id>]        # dry-run
 *   node scripts/backfill-437-remove-personal-code.cjs --apply --project <id>  # write
 *
 * Auth: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or an
 * authenticated gcloud env). To test against the emulator, export
 * FIRESTORE_EMULATOR_HOST first.
 *
 * DEPLOY STEP: manual, post-merge — not part of the automatic deploy
 * pipeline (see project memory: only manual items are this kind of one-off
 * backfill plus the existing endorsement-count backfill).
 */

/**
 * True if this users doc has a tutor profile still carrying `personalCode`.
 * Pure — unit-testable without the admin SDK.
 */
function needsPatch(data) {
  return typeof data?.profiles?.tutor?.personalCode === 'string';
}

module.exports = { needsPatch };

async function main() {
  // firebase-admin is not installed at the repo root; resolve it through the
  // functions workspace (same pattern as the other backfill-4xx scripts).
  const { createRequire } = require('module');
  const path = require('path');
  const fnRequire = createRequire(path.resolve(__dirname, '../apps/functions/package.json'));
  const { initializeApp } = fnRequire('firebase-admin/app');
  const { getFirestore, FieldValue } = fnRequire('firebase-admin/firestore');

  const argv = process.argv.slice(2);
  const projectFlagIdx = argv.indexOf('--project');
  const projectId =
    projectFlagIdx !== -1 ? argv[projectFlagIdx + 1] : process.env.GCLOUD_PROJECT || undefined;
  const apply =
    (argv.includes('--apply') || process.env.APPLY === '1') && process.env.DRY_RUN !== '1';

  const app = initializeApp(projectId ? { projectId } : undefined);
  const db = getFirestore(app);

  console.log(`\nBackfill remove profiles.tutor.personalCode — mode: ${apply ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(`  Target: EMULATOR at ${process.env.FIRESTORE_EMULATOR_HOST}`);
  }

  const usersSnap = await db.collection('users')
    .where('profiles.tutor.personalCode', '>', '')
    .get();
  console.log(`  Found ${usersSnap.size} tutor doc(s) carrying a personalCode.\n`);

  let updated = 0;
  for (const userDoc of usersSnap.docs) {
    if (!needsPatch(userDoc.data())) continue; // defensive; the query above already filters
    if (apply) {
      await userDoc.ref.update({ 'profiles.tutor.personalCode': FieldValue.delete() });
      console.log(`  WRITE users/${userDoc.id} — removed personalCode`);
    } else {
      console.log(`  WOULD users/${userDoc.id} — remove personalCode`);
    }
    updated += 1;
  }

  console.log(`\nDone. ${apply ? 'Removed' : 'Would remove'} personalCode from ${updated} doc(s).`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
