/**
 * One-shot backfill — issue #369: reshape `users/{uid}.notifPrefs` from the
 * pre-#369 FLAT map of event category -> channels into the APP-SCOPED shape
 * `{ shared, sit, study, do }` (owner decision, option 1).
 *
 * WHAT IT WRITES, and why it writes it that way:
 *
 *   shared <- { reminders, references }
 *     These two are cross-app by nature (one calendar, one reputation), so
 *     the flat values move straight across.
 *
 *   sit / study / do <- { newRequest, confirmed, cancelled }, THE SAME VALUES
 *     COPIED INTO ALL THREE.
 *     The flat map was consulted by every app's senders, so before this
 *     backfill a stored `newRequest: { email: false }` suppressed sit mail,
 *     study mail and do mail alike. Copying it into all three blocks is the
 *     only mapping under which NOBODY's delivery changes on migration day.
 *     Seeding only the apps a user "looks like" they use would guess, and
 *     guessing wrong un-mutes somebody who opted out — the exact failure
 *     issue #369 exists to prevent.
 *     Writing a block for an app the user does not use is inert: which
 *     blocks a user is SHOWN is decided at render time by
 *     `notifPrefScopesForUser`, from the profiles they hold, never from
 *     which blocks happen to exist in their document.
 *
 *   The legacy FLAT keys are LEFT IN PLACE.
 *     A deploy is not instantaneous: for one release, function instances
 *     running the previous build still read the flat keys. Deleting them
 *     here would silently reset those readers to the product defaults and
 *     un-mute users mid-rollout. They are removed later, together with the
 *     `LegacyNotifPrefs` type and the transitional branch in
 *     `resolveNotifPref` — see the follow-up on issue #369.
 *
 * IDEMPOTENT: a doc that already carries any of `shared`/`sit`/`study`/`do`
 * is skipped untouched, so a re-run only picks up docs the previous run
 * missed. A doc with NO `notifPrefs` field is also skipped: absence already
 * resolves to the product defaults through `resolveNotifPref`, so writing
 * defaults into it would be noise, not a fix.
 *
 * DRY-RUN BY DEFAULT: prints what would change and writes nothing. Set
 * APPLY=1 to actually write (DRY_RUN=1 forces a dry-run even if APPLY is
 * set).
 *
 * Run from the repo root:
 *   pnpm backfill:369-app-scoped-notifprefs [-- --project <id>]        # dry-run
 *   APPLY=1 pnpm backfill:369-app-scoped-notifprefs -- --project <id>  # write
 * To test against the emulator, export FIRESTORE_EMULATOR_HOST first.
 * Auth is Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or
 * an authenticated gcloud environment).
 *
 * DEPLOY STEP: run ONCE against prod right after the issue #369 release
 * ships. Until it has run, un-backfilled docs are served by the transitional
 * flat-shape read in `resolveNotifPref`; the follow-up that deletes that
 * branch is blocked on this having run.
 */

const SHARED_CATEGORIES = ['reminders', 'references'];
const APP_CATEGORIES = ['newRequest', 'confirmed', 'cancelled'];
const APP_SCOPES = ['sit', 'study', 'do'];
const NEW_BLOCKS = ['shared'].concat(APP_SCOPES);

/** A channel map worth copying: an object carrying at least one boolean. */
function isChannels(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return typeof value.push === 'boolean' || typeof value.email === 'boolean';
}

function pickChannels(source, keys) {
  const out = {};
  for (const key of keys) {
    if (isChannels(source[key])) {
      const stored = source[key];
      const channels = {};
      if (typeof stored.push === 'boolean') channels.push = stored.push;
      if (typeof stored.email === 'boolean') channels.email = stored.email;
      out[key] = channels;
    }
  }
  return out;
}

/**
 * Pure, SDK-free: the dotted-path patch this user doc needs, or `null` when
 * it needs none (already migrated, no notifPrefs, or nothing copyable).
 * Dotted paths rather than a whole-object write, so a concurrent client
 * toggle into one block cannot be clobbered by this backfill.
 */
function appScopedPatch(userData) {
  const prefs = userData && userData.notifPrefs;
  if (typeof prefs !== 'object' || prefs === null || Array.isArray(prefs)) return null;

  // Already migrated — root presence is authoritative, never re-derived from
  // the flat copy that is deliberately left beside it.
  if (NEW_BLOCKS.some((block) => prefs[block] !== undefined)) return null;

  const shared = pickChannels(prefs, SHARED_CATEGORIES);
  const perApp = pickChannels(prefs, APP_CATEGORIES);

  const patch = {};
  if (Object.keys(shared).length > 0) patch['notifPrefs.shared'] = shared;
  if (Object.keys(perApp).length > 0) {
    for (const app of APP_SCOPES) patch[`notifPrefs.${app}`] = perApp;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

module.exports = { appScopedPatch, isChannels, pickChannels };

async function main() {
  // firebase-admin isn't installed at repo root; resolve it through the
  // functions workspace. Lazy require so unit tests can import the pure
  // helpers above without pulling in the admin SDK.
  const { createRequire } = require('module');
  const path = require('path');
  const fnRequire = createRequire(path.resolve(__dirname, '../apps/functions/package.json'));
  const { initializeApp } = fnRequire('firebase-admin/app');
  const { getFirestore } = fnRequire('firebase-admin/firestore');

  const argv = process.argv.slice(2);
  const projectFlagIdx = argv.indexOf('--project');
  const projectId = projectFlagIdx > -1 ? argv[projectFlagIdx + 1] : undefined;
  const apply = process.env.APPLY === '1' && process.env.DRY_RUN !== '1';

  const db = getFirestore(initializeApp(projectId ? { projectId } : {}));

  console.log(
    apply
      ? '[369] APPLYING app-scoped notifPrefs backfill'
      : '[369] DRY RUN — no writes. Set APPLY=1 to write.',
  );

  const snap = await db.collection('users').get();
  let scanned = 0;
  let migrated = 0;
  let alreadyMigrated = 0;
  let noPrefs = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    scanned++;
    const data = doc.data();
    const patch = appScopedPatch(data);
    if (!patch) {
      const prefs = data && data.notifPrefs;
      if (
        typeof prefs === 'object' &&
        prefs !== null &&
        NEW_BLOCKS.some((block) => prefs[block] !== undefined)
      ) {
        alreadyMigrated++;
      } else {
        noPrefs++;
      }
      continue;
    }

    console.log(
      `${apply ? 'SET ' : 'WOULD SET'} ${doc.id}: ${JSON.stringify(patch)}`,
    );
    if (apply) {
      try {
        await doc.ref.update(patch);
        migrated++;
      } catch (err) {
        failed++;
        console.error(`  FAILED ${doc.id}:`, err && err.message ? err.message : err);
      }
    } else {
      migrated++;
    }
  }

  console.log(
    `[369] scanned=${scanned} ${apply ? 'migrated' : 'wouldMigrate'}=${migrated} ` +
      `alreadyMigrated=${alreadyMigrated} noPrefsToCopy=${noPrefs} failed=${failed}`,
  );
  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
