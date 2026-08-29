/**
 * Platform-wide data-retention windows.
 *
 * Decision 19 (sync-do plan §2, §11.4; owner, PR #243 review): "There's no
 * reason to retain completed engagement indefinitely — in any of the sync
 * apps. Let's set a retention period of 6 months."
 *
 * ONE number for all three apps deliberately: sync-do shipped it as
 * `DO_COMPLETED_RETENTION_DAYS` (which now re-exports this), and issue #294
 * built the sit and study halves on the same constant so the three sweeps can
 * never drift apart the way an app-local copy would.
 */
export const COMPLETED_ENGAGEMENT_RETENTION_DAYS = 180;
