/**
 * One-shot backfill — denormalize `profiles.tutor.endorsementCount` onto tutor
 * user docs for study endorsements that predate the counter.
 *
 * The counter is server-owned (respondToTutorEndorsement increments it on
 * accept). Approved endorsements created BEFORE that code shipped never bumped
 * the counter, so searchTutors — which now reads the counter instead of scanning
 * the references collection — would under-report them. This script recomputes
 * each tutor's count from the references collection and SETs it.
 *
 * Idempotent: it SETs the recomputed value (never increments), so re-running is
 * a no-op. It considers EVERY tutor that appears in a study reference, so a tutor
 * whose approved endorsements were all removed is correctly reset to 0.
 *
 * DRY-RUN BY DEFAULT: prints what would change and writes nothing. Pass
 * `--execute` to actually write.
 *
 * Colocated in apps/study-functions so `firebase-admin` resolves (mirrors
 * apps/functions/seed-admin.cjs). Run from the repo root:
 *   node apps/study-functions/backfill-endorsement-counts.cjs [--project <id>]            # dry-run
 *   node apps/study-functions/backfill-endorsement-counts.cjs --execute [--project <id>]  # write
 *   pnpm backfill:endorsement-counts -- --execute --project <id>                          # via root script
 *
 * Auth: uses Application Default Credentials (set GOOGLE_APPLICATION_CREDENTIALS
 * to a service-account key, or run inside an authenticated gcloud env). To test
 * against the emulator, export FIRESTORE_EMULATOR_HOST first.
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// ── Args ──
const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const projectFlagIdx = argv.indexOf('--project');
const PROJECT_ID =
  projectFlagIdx !== -1 ? argv[projectFlagIdx + 1] : process.env.GCLOUD_PROJECT || undefined;

// A study endorsement is "visible" (counts) when approved or published.
const VISIBLE_STATUSES = new Set(['approved', 'published']);

const app = initializeApp(PROJECT_ID ? { projectId: PROJECT_ID } : undefined);
const db = getFirestore(app);

async function backfill() {
  console.log(`\nBackfill endorsement counts — mode: ${EXECUTE ? 'EXECUTE (writing)' : 'DRY-RUN (no writes)'}`);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(`  Target: EMULATOR at ${process.env.FIRESTORE_EMULATOR_HOST}`);
  }

  // Single equality filter (appSource) keeps this index-free — mirrors the query
  // searchTutors used to run per call.
  const refsSnap = await db.collection('references').where('appSource', '==', 'study').get();

  // Every tutor that appears in ANY study reference → its visible-endorsement
  // count (0 if none are approved/published). Tracking the full set (not just
  // tutors with a positive count) lets the SET reset a tutor back to 0.
  const counts = new Map();
  refsSnap.docs.forEach((d) => {
    const data = d.data();
    const tutorId = data.tutorUserId;
    if (!tutorId) return;
    const current = counts.get(tutorId) || 0;
    counts.set(tutorId, current + (VISIBLE_STATUSES.has(data.status) ? 1 : 0));
  });

  console.log(`  Scanned ${refsSnap.size} study references across ${counts.size} tutor(s).\n`);

  let changed = 0;
  let unchanged = 0;
  let missing = 0;

  for (const [tutorId, count] of counts) {
    const userRef = db.collection('users').doc(tutorId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      console.log(`  SKIP  users/${tutorId} — no such user doc`);
      missing += 1;
      continue;
    }
    const existing = userSnap.data()?.profiles?.tutor?.endorsementCount;
    if (existing === count) {
      unchanged += 1;
      continue;
    }
    console.log(`  ${EXECUTE ? 'SET ' : 'WOULD SET'}  users/${tutorId}.profiles.tutor.endorsementCount: ${existing ?? '(unset)'} → ${count}`);
    if (EXECUTE) {
      await userRef.update({ 'profiles.tutor.endorsementCount': count });
    }
    changed += 1;
  }

  console.log(`\nSummary: ${changed} ${EXECUTE ? 'updated' : 'to update'}, ${unchanged} already correct, ${missing} missing user doc(s).`);
  if (!EXECUTE && changed > 0) {
    console.log('Re-run with --execute to apply.');
  }
  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
