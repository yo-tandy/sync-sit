/**
 * Where the sibling sync-sit app lives. Overridable per environment
 * (.env.development points at the local sit dev server); production builds
 * fall back to the deployed origin.
 */
export const SIT_APP_URL: string = (
  import.meta.env.VITE_SIT_APP_URL ?? 'https://sync-sit.com'
).replace(/\/$/, '');
