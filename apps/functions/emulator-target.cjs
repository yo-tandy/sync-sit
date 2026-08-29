/**
 * Where a seed script should write — the shared emulator-endpoint resolver,
 * reached from CJS, with operator mistakes turned into readable output.
 *
 * The resolver itself lives in
 * `packages/shared-core/src/utils/emulatorConfig.ts` and is the SAME function
 * the three web apps call with `import.meta.env` (issue #358). Issue #376:
 * the seed scripts used to hardcode lane 1, so pointing an app at lane 3 gave
 * you an app talking to an empty stack. They now go through here, so there is
 * one implementation of the lane arithmetic and the browser and the seeder
 * cannot disagree about where lane 3 is.
 *
 * Everything else here is presentation. Every failure this can hit is
 * something the operator typed — a bad lane, a leftover
 * FIRESTORE_EMULATOR_HOST, an unbuilt package — and a V8 stack trace over a
 * one-line "you are pointed at the wrong lane" is how that gets skimmed past.
 *
 * `@ejm/shared-core` publishes its CJS entry from `dist/`, which a plain
 * `git clone && pnpm install` does not build. `pnpm seed:admin` /
 * `pnpm seed:test-data` build it first; a direct `node
 * apps/functions/seed-*.cjs` does not. Both ways that can bite have to say
 * the same thing: `dist/` MISSING (a bare MODULE_NOT_FOUND naming a path)
 * and `dist/` STALE — built before these functions existed, where `require`
 * succeeds and the script dies later on `undefined is not a function`,
 * pointing at the wrong file entirely.
 */

const RESOLVER = '@ejm/shared-core/utils/emulatorConfig.js';
const NEEDED = ['resolveNodeEmulatorConfig', 'emulatorAdminHosts', 'assertEmulatorAdminHostsAgree'];

function unbuilt(why) {
  console.error(
    '\n  Could not load ' +
      RESOLVER +
      ':\n  ' +
      why +
      '\n\n' +
      '  @ejm/shared-core is not built, or its build is stale. Run:\n\n' +
      '    pnpm --filter @ejm/shared-core build\n\n' +
      '  (or use `pnpm seed:admin` / `pnpm seed:test-data`, which build it first)\n',
  );
  process.exit(1);
}

let resolver;
try {
  resolver = require(RESOLVER);
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes('shared-core')) {
    unbuilt('module not found');
  }
  throw err;
}

const missing = NEEDED.filter((name) => typeof resolver[name] !== 'function');
if (missing.length > 0) {
  unbuilt('loaded, but it does not export ' + missing.join(', '));
}

/**
 * Resolve where this seed run should write, and set the firebase-admin env
 * vars to match. Returns the resolved config so the caller can print it.
 *
 * `defaultHost` is the host the calling script used before it was
 * lane-aware — the two scripts disagree (`localhost` vs `127.0.0.1`) and each
 * keeps its own, so a run with no env set is unchanged.
 */
function applySeedEmulatorTarget(env, defaultHost) {
  let config;
  let hosts;
  try {
    config = resolver.resolveNodeEmulatorConfig(env, { defaultHost });
    hosts = resolver.emulatorAdminHosts(config);
    resolver.assertEmulatorAdminHostsAgree(env, config);
  } catch (err) {
    console.error('\n  Cannot decide which emulator lane to seed:\n\n    ' + err.message + '\n');
    process.exit(1);
  }
  Object.assign(env, hosts);
  return config;
}

// Only what the seed scripts call. `NEEDED` above is then the single
// statement of what this shim requires from `dist/`.
module.exports = { applySeedEmulatorTarget };
