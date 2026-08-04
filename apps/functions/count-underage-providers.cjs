/**
 * Diagnostic count — measure how many provider profiles (babysitter + tutor)
 * would be affected by the enrollment age gate (governance PR 1).
 *
 * For EACH provider type it buckets every profile into:
 *   (a) DOB-under-15            — the search backstop / enrollment floor would fire
 *   (b) missing DOB             — legacy profiles the backstop deliberately skips
 *   (c) unparseable ejemEmail   — no (currently valid) grad year → consistency
 *                                 check is skipped at search
 *   (d) DOB/grad-year mismatch  — beyond the one-class tolerance (would need an
 *                                 exemption to stay searchable)
 * Buckets are measured independently: an under-15 provider with a mismatched
 * email appears in BOTH (a) and (d). Affected uids are listed per bucket.
 *
 * READ-ONLY: this script never writes. There is no --execute mode.
 *
 * Colocated in apps/functions so `firebase-admin` and the built
 * `@ejm/shared-core` (age policy source of truth) resolve. Run from the repo root:
 *   node apps/functions/count-underage-providers.cjs [--project <id>]
 *   pnpm --filter functions count:underage-providers [-- --project <id>]
 *
 * Auth: uses Application Default Credentials (set GOOGLE_APPLICATION_CREDENTIALS
 * to a service-account key, or run inside an authenticated gcloud env). To test
 * against the emulator, export FIRESTORE_EMULATOR_HOST first.
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { validateEjmEmail, expectedAgeForGradYear } = require('@ejm/shared-core');

// ── Args ──
const argv = process.argv.slice(2);
const projectFlagIdx = argv.indexOf('--project');
const PROJECT_ID =
  projectFlagIdx !== -1 ? argv[projectFlagIdx + 1] : process.env.GCLOUD_PROJECT || undefined;

const app = initializeApp(PROJECT_ID ? { projectId: PROJECT_ID } : undefined);
const db = getFirestore(app);

/** Full years elapsed since dob (UTC calendar — diagnostic precision is fine). */
function fullYears(dob, now) {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function emptyBuckets() {
  return { total: 0, under15: [], missingDob: [], unparseableEmail: [], mismatch: [] };
}

function classify(buckets, uid, dateOfBirth, ejemEmail, now) {
  buckets.total += 1;
  const dob = toDate(dateOfBirth);
  const emailCheck = validateEjmEmail(ejemEmail || '', now);
  const parseable = emailCheck.valid && emailCheck.graduationYear !== undefined;

  if (!dob) buckets.missingDob.push(uid);
  if (!parseable) buckets.unparseableEmail.push(uid);
  if (dob) {
    const age = fullYears(dob, now);
    if (age < 15) buckets.under15.push(uid);
    if (parseable && Math.abs(age - expectedAgeForGradYear(emailCheck.graduationYear, now)) > 1) {
      buckets.mismatch.push(uid);
    }
  }
}

function printBuckets(label, buckets) {
  const line = (name, uids) =>
    console.log(`  ${name}: ${uids.length}${uids.length ? `  [${uids.join(', ')}]` : ''}`);
  console.log(`\n${label} — ${buckets.total} profile(s)`);
  line('(a) DOB under 15          ', buckets.under15);
  line('(b) missing DOB           ', buckets.missingDob);
  line('(c) unparseable ejemEmail ', buckets.unparseableEmail);
  line('(d) DOB/grad-year mismatch', buckets.mismatch);
}

async function count() {
  console.log('\nCount underage/mismatched providers — READ-ONLY (no writes, ever)');
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(`  Target: EMULATOR at ${process.env.FIRESTORE_EMULATOR_HOST}`);
  }

  const now = new Date();
  const usersSnap = await db.collection('users').get();

  const babysitters = emptyBuckets();
  const tutors = emptyBuckets();

  usersSnap.docs.forEach((doc) => {
    const user = doc.data();
    const profiles = user.profiles || {};
    if (profiles.babysitter) {
      classify(babysitters, doc.id, user.dateOfBirth, profiles.babysitter.ejemEmail, now);
    }
    if (profiles.tutor) {
      classify(tutors, doc.id, user.dateOfBirth, profiles.tutor.ejemEmail, now);
    }
  });

  console.log(`\nScanned ${usersSnap.size} user doc(s).`);
  printBuckets('Babysitter profiles', babysitters);
  printBuckets('Tutor profiles', tutors);
  console.log('');
  process.exit(0);
}

count().catch((err) => {
  console.error('Count failed:', err);
  process.exit(1);
});
