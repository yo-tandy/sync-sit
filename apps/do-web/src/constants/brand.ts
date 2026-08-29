/**
 * Brand constants for Sync/Do (mirrors apps/web/src/constants/brand.ts).
 *
 * The address is deliberately NOT support@sync-do.com (issue #349):
 * sync-do.com is neither connected nor Resend-verified, so every member
 * reading the legal pages on the live sync-do-app.web.app and mailing that
 * address got a bounce. sync-sit.com is the one domain that receives, and
 * the server side already made this exact call --
 * apps/functions/src/do/notifyContent.ts sends do's digest opt-out link to
 * support@sync-sit.com and its copy suite bans sync-do.com outright. The
 * brand shown to the member stays Sync/Do; only the mailbox is shared.
 * Revisit when the suite moves to one verified domain (plan §18.9), at
 * which point all three apps change here together.
 */
export const BRAND = 'Sync/Do';
export const SUPPORT_EMAIL = 'support@sync-sit.com';
