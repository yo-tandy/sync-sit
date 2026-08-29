/**
 * App identity constants. Extracted from router.tsx (PR for issues
 * #339/#340) so the burger menu's "Send feedback" entry and the legal
 * pages address the SAME mailbox -- two literals drift, one constant
 * cannot. Mirrors apps/web/src/constants/brand.ts.
 */
export const BRAND = 'Sync/Study';

/**
 * Deliberately on sync-sit.com, not sync-study.com (issue #115).
 *
 * sync-study.com is not registered -- it has no NS records and no MX, so
 * every message to support@sync-study.com bounces. The address was published
 * on the About page, the Report-a-problem page and the burger menu, so the
 * documented way to reach support from Sync/Study was a dead end.
 *
 * sync-sit.com is the domain that exists and receives mail (Cloudflare MX),
 * and it is already the verified sender for BOTH apps' outbound mail --
 * `FROM_EMAIL` is `noreply@sync-sit.com` regardless of app, because Resend
 * validates the domain and not the display name (issue #156). Inbound now
 * matches outbound.
 *
 * This moves when the domain does (plan 18.9): a support address on the new
 * domain needs that domain registered and its MX configured, which is the
 * same DNS work as the sender move and should happen in one pass.
 */
export const SUPPORT_EMAIL = 'support@sync-sit.com';
