/**
 * Re-export shim: the predicate moved to shared-functions when sit adopted
 * the notice-window system (issue #237) — one lateness definition for both
 * apps, and this file keeps study's five call sites byte-unchanged.
 */
export { isLateCancellation } from '@ejm/shared-functions/schedule/lateCancellation.js';
