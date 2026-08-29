/**
 * CJS access to the shared emulator-endpoint resolver, for the seed scripts.
 *
 * The resolver itself lives in
 * `packages/shared-core/src/utils/emulatorConfig.ts` and is the SAME function
 * the three web apps call with `import.meta.env` (issue #358). Issue #376:
 * the seed scripts used to hardcode lane 1, so pointing an app at lane 3 gave
 * you an app talking to an empty stack. They now go through here, so there is
 * one implementation of the lane arithmetic and the browser and the seeder
 * cannot disagree about where lane 3 is.
 *
 * This file exists only to turn a missing `dist/` into an actionable message.
 * `@ejm/shared-core` publishes its CJS entry from `dist/`, which a plain
 * `git clone && pnpm install` does not build — `pnpm seed:admin` /
 * `pnpm seed:test-data` build it for you, but `node apps/functions/seed-*.cjs`
 * run directly does not, and a bare MODULE_NOT_FOUND does not tell you that.
 */

const RESOLVER = '@ejm/shared-core/utils/emulatorConfig.js';

let resolver;
try {
  resolver = require(RESOLVER);
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes('shared-core')) {
    console.error(
      '\n  Could not load ' +
        RESOLVER +
        '.\n' +
        '  @ejm/shared-core has not been built. Run:\n\n' +
        '    pnpm --filter @ejm/shared-core build\n\n' +
        '  (or use `pnpm seed:admin` / `pnpm seed:test-data`, which build it first)\n',
    );
    process.exit(1);
  }
  throw err;
}

module.exports = { resolveNodeEmulatorConfig: resolver.resolveNodeEmulatorConfig };
