/**
 * App identity constants. Extracted from router.tsx (PR for issues
 * #339/#340) so the burger menu's "Send feedback" entry and the legal
 * pages address the SAME mailbox -- two literals drift, one constant
 * cannot. Mirrors apps/web/src/constants/brand.ts.
 *
 * SUPPORT_EMAIL points at sync-sit.com, not sync-study.com: as of
 * 2026-08-29 `sync-study.com` has no MX record (and no A record), so the
 * per-app address published here bounced silently — on the very pages a
 * user reaches when something has already gone wrong. sync-sit.com is the
 * only domain in the suite that receives mail. Restore a per-app address
 * the day this domain has an MX record, not before. See issue #349.
 */
export const BRAND = 'Sync/Study';
export const SUPPORT_EMAIL = 'support@sync-sit.com';
