/**
 * How old the *credential* behind a session is — not how old the session's
 * most recent sign-in event is.
 *
 * `auth_time` normally answers both, because the only way to start a new
 * authentication event is to present a credential. Cross-app handoff
 * (`handoff/appHandoff.ts`) breaks that: `redeemAppHandoffCode` mints a custom
 * token for a uid whose session may be a month old, and signing in with it
 * stamps a brand-new `auth_time`. Anything gating on "authenticated recently"
 * — `deleteMyAccount`'s re-auth window, and any future guard that joins it —
 * would read that as a fresh credential when nobody typed a password.
 *
 * So the handoff carries the originating session's effective auth time into
 * the minted token as `originalAuthTime`, and this function prefers the OLDER
 * of the two. Consequences of that rule, all deliberate:
 *
 *  - a handoff session inherits the age of the session it came from, so
 *    switching apps cannot refresh a re-auth window;
 *  - chaining handoffs cannot launder it either, because
 *    `createAppHandoffCode` records THIS function's output, not raw
 *    `auth_time`;
 *  - a real re-authentication in the destination app clears the claim (custom
 *    -token developer claims do not survive a password sign-in), so the member
 *    gets their fresh window back the honest way;
 *  - taking the minimum rather than trusting the claim outright means a claim
 *    that somehow read NEWER than `auth_time` could only ever make the guard
 *    stricter.
 *
 * Returns 0 for a token shape we did not expect — callers treat that as stale
 * rather than as permission.
 */

/**
 * Developer claim naming the originating session's effective auth time
 * (seconds since epoch). Not a reserved Firebase/OIDC claim name, so
 * `createCustomToken` accepts it.
 */
export const ORIGINAL_AUTH_TIME_CLAIM = 'originalAuthTime';

/** A finite, positive epoch-seconds value, or 0 for anything else. */
function epochSeconds(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param token the decoded ID token (`request.auth.token`).
 * @returns seconds since epoch of the last real credential presentation, or 0
 *   when the token carries no usable `auth_time` at all.
 */
export function effectiveAuthTimeSeconds(token: Record<string, unknown> | undefined): number {
  const authTime = epochSeconds(token?.auth_time);
  const carried = epochSeconds(token?.[ORIGINAL_AUTH_TIME_CLAIM]);
  if (!carried) return authTime;
  if (!authTime) return carried;
  return Math.min(authTime, carried);
}
