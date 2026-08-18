/**
 * One-shot backfill — derive `postcode`/`city` on family docs from their
 * stored `address` string (issue #167).
 *
 * Family docs created before #167 hold only the display address + latLng, so
 * study search cannot resolve their coverage-area label and arrondissement-mode
 * tutors are excluded from their home/library queries until the parent re-picks
 * an address. This script closes that day-one gap by geocoding the stored
 * address through the SAME endpoint AddressAutocomplete uses
 * (api-adresse.data.gouv.fr) and writing the top match's postcode/city.
 *
 * Selection: every families/{id} doc with a non-empty `address` and no
 * `postcode` (missing or null). Docs the geocoder cannot match are logged and
 * skipped — they self-heal the next time the family picks an address in
 * enrollment-era settings/search.
 *
 * Idempotent: postcode-bearing docs are never touched, so re-running only
 * retries previous skips.
 *
 * DRY-RUN BY DEFAULT: prints what would change and writes nothing. Set APPLY=1
 * to actually write (DRY_RUN=1 forces a dry-run even if APPLY is set).
 *
 * Run from the repo root:
 *   node scripts/backfill-family-postcode.cjs [--project <id>]     # dry-run
 *   APPLY=1 node scripts/backfill-family-postcode.cjs --project <id>  # write
 *
 * Auth: Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or an
 * authenticated gcloud env). To test against the emulator, export
 * FIRESTORE_EMULATOR_HOST first.
 */

// Same endpoint as packages/shared-ui/src/forms/AddressAutocomplete.tsx.
const GEOCODE_URL = 'https://api-adresse.data.gouv.fr/search/';

// Bounds mirror familyEnrollmentSchema (and the firestore.rules shape check).
const MAX_POSTCODE_LEN = 20;
const MAX_CITY_LEN = 100;

/**
 * Extract {postcode, city} from an api-adresse /search response. Returns null
 * when the response has no usable top feature — malformed, empty, or missing
 * either component.
 */
function extractPostcodeCity(searchResponse) {
  const props = searchResponse?.features?.[0]?.properties;
  const postcode = props?.postcode;
  const city = props?.city;
  if (typeof postcode !== 'string' || postcode.length === 0 || postcode.length > MAX_POSTCODE_LEN) {
    return null;
  }
  if (typeof city !== 'string' || city.length === 0 || city.length > MAX_CITY_LEN) {
    return null;
  }
  return { postcode, city };
}

/**
 * Whether a family doc is a backfill candidate: has a non-empty string
 * address and no postcode yet (missing or null). Docs that already carry a
 * postcode — post-#167 writes — are never touched.
 */
function needsBackfill(familyData) {
  return (
    typeof familyData?.address === 'string' &&
    familyData.address.trim() !== '' &&
    (familyData.postcode === undefined || familyData.postcode === null)
  );
}

async function main() {
  // firebase-admin is not installed at the repo root; resolve it through the
  // functions workspace (mirrors why backfill-endorsement-counts.cjs is
  // colocated in apps/study-functions). Lazy so unit tests can import the
  // pure helpers above without pulling in the admin SDK.
  const { createRequire } = require('module');
  const path = require('path');
  const fnRequire = createRequire(path.resolve(__dirname, '../apps/functions/package.json'));
  const { initializeApp } = fnRequire('firebase-admin/app');
  const { getFirestore } = fnRequire('firebase-admin/firestore');

  const argv = process.argv.slice(2);
  const projectFlagIdx = argv.indexOf('--project');
  const projectId =
    projectFlagIdx !== -1 ? argv[projectFlagIdx + 1] : process.env.GCLOUD_PROJECT || undefined;
  const apply = process.env.APPLY === '1' && process.env.DRY_RUN !== '1';

  const app = initializeApp(projectId ? { projectId } : undefined);
  const db = getFirestore(app);

  console.log(`\nBackfill family postcode/city — mode: ${apply ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.log(`  Target: EMULATOR at ${process.env.FIRESTORE_EMULATOR_HOST}`);
  }

  const familiesSnap = await db.collection('families').get();
  console.log(`  Scanned ${familiesSnap.size} family doc(s).\n`);

  let updated = 0;
  let skippedHasPostcode = 0;
  let skippedNoAddress = 0;
  let noMatch = 0;
  let failed = 0;

  for (const familyDoc of familiesSnap.docs) {
    const data = familyDoc.data();
    if (!needsBackfill(data)) {
      if (typeof data?.address === 'string' && data.address.trim() !== '') {
        skippedHasPostcode += 1;
      } else {
        skippedNoAddress += 1;
      }
      continue;
    }

    let resolved = null;
    try {
      const res = await fetch(
        `${GEOCODE_URL}?q=${encodeURIComponent(data.address)}&limit=1`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      resolved = extractPostcodeCity(await res.json());
    } catch (err) {
      console.log(`  FAIL  families/${familyDoc.id} — geocode error for "${data.address}": ${err.message}`);
      failed += 1;
      continue;
    }

    if (!resolved) {
      console.log(`  SKIP  families/${familyDoc.id} — no geocoder match for "${data.address}" (self-heals on next address edit)`);
      noMatch += 1;
      continue;
    }

    console.log(
      `  ${apply ? 'SET ' : 'WOULD SET'}  families/${familyDoc.id}: postcode=${resolved.postcode} city=${resolved.city} (from "${data.address}")`,
    );
    if (apply) {
      await familyDoc.ref.update({ postcode: resolved.postcode, city: resolved.city });
    }
    updated += 1;

    // Courtesy pacing for the public geocoder (well under its rate limit).
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(
    `\nSummary: ${updated} ${apply ? 'updated' : 'to update'}, ${skippedHasPostcode} already have postcode, ${skippedNoAddress} without address, ${noMatch} unmatched, ${failed} geocode failure(s).`,
  );
  if (!apply && updated > 0) {
    console.log('Re-run with APPLY=1 to write.');
  }
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = { extractPostcodeCity, needsBackfill, GEOCODE_URL };

if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}
