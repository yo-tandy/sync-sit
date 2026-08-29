/**
 * App identity constants. Extracted from router.tsx (PR for issues
 * #339/#340) so the burger menu's "Send feedback" entry and the legal
 * pages address the SAME mailbox -- two literals drift, one constant
 * cannot. Mirrors apps/web/src/constants/brand.ts.
 */
export const BRAND = 'Sync/Study';
export const SUPPORT_EMAIL = 'support@sync-study.com';
