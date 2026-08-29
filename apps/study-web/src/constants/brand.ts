/**
 * App identity constants. Extracted from router.tsx (PR for issues
 * #339/#340) so the burger menu's "Send feedback" entry and the legal
 * pages address the SAME mailbox -- two literals drift, one constant
 * cannot. Mirrors apps/web/src/constants/brand.ts.
 *
 * The address is deliberately NOT support@sync-study.com: sync-study.com
 * was never connected (issue #115), so mail to it bounced with no error
 * anyone could see. sync-sit.com is the one domain that actually receives,
 * and the same rule already governs the server side --
 * apps/functions/src/do/notifyContent.ts routes do's support link here too.
 * The brand shown to the member stays Sync/Study; only the mailbox is
 * shared. Revisit when the suite moves to one verified domain (plan
 * §18.9), at which point all three apps change here together.
 */
export const BRAND = 'Sync/Study';
export const SUPPORT_EMAIL = 'support@sync-sit.com';
