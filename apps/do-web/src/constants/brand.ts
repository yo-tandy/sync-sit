/**
 * Brand constants for Sync/Do (mirrors apps/web/src/constants/brand.ts).
 *
 * SUPPORT_EMAIL points at the sync-sit.com mailbox, not a per-app address:
 * it is the only domain in the suite that actually RECEIVES mail. As of
 * 2026-08-29 `sync-do.com` and `sync-study.com` have no MX record (and no A
 * record — they are unregistered/unconfigured), so a per-app address there
 * bounces silently on a page users reach when something has already gone
 * wrong. Give this app its own address the day its domain has an MX record,
 * not before. See issue #349.
 */
export const BRAND = 'Sync/Do';
export const SUPPORT_EMAIL = 'support@sync-sit.com';
