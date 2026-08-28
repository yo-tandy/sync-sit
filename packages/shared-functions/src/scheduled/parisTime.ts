/**
 * The Europe/Paris wall-clock helpers were hoisted into
 * `@ejm/shared-core/utils/parisTime.ts` (issue #309) so `@ejm/do-core` —
 * which cannot depend on shared-functions — shares the same DST-correct
 * implementation (the #74 two-pass fix in `parisWallTimeToUtc`). Re-exported
 * here so every existing `@ejm/shared-functions/scheduled/parisTime.js`
 * import site (sit + study functions) stays untouched.
 *
 * Named re-export from the package root (not the `/utils/parisTime.js`
 * subpath) because this package's CJS deploy build uses `node10` module
 * resolution, which ignores shared-core's `exports` subpath map.
 */
export {
  parisDateString,
  parisWallTimeToUtc,
  parisWallClockPosition,
} from '@ejm/shared-core';
