/**
 * Where the sibling sync-sit app lives. Overridable per environment
 * (.env.development points at the local sit dev server); production builds
 * fall back to the deployed origin.
 */
export const SIT_APP_URL: string = (
  import.meta.env.VITE_SIT_APP_URL ?? 'https://sync-sit.web.app'
).replace(/\/$/, '');

/**
 * Sit's family verification page (issue #129). Deep-link destinations for the
 * cross-app switch MUST be compile-time constants like this one — a RELATIVE
 * path on the sit origin, never a full URL and never user input. The sit
 * handoff page independently re-validates whatever `dest` it receives (the
 * handoff URL is attacker-visible surface), but keeping the source a constant
 * means study can never even emit a hostile value.
 */
export const SIT_VERIFICATION_PATH = '/family/verification';
