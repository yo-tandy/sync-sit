/**
 * Where the sibling sync-sit app lives. Overridable per environment
 * (.env.development points at the local sit dev server); production builds
 * fall back to the deployed origin.
 */
export const SIT_APP_URL: string = (
  import.meta.env.VITE_SIT_APP_URL ?? 'https://sync-sit.com'
).replace(/\/$/, '');

/**
 * sit's unified sign-up entry point (issue #435 milestone, PR5): sync-study
 * no longer runs its own role question, so every in-app "sign up" link
 * (and the retired `/signup` route itself) sends visitors here instead.
 * Carries the CURRENT language across the origin switch the same way the
 * handoff mechanism does (`AppSwitchMenuItem`) — i18n caches are per-origin
 * localStorage, so the target has no record of the visitor's choice yet.
 */
export function sitSignUpUrl(language: string | undefined): string {
  const lang = language?.startsWith('fr') ? 'fr' : 'en';
  return `${SIT_APP_URL}/enroll?lang=${encodeURIComponent(lang)}`;
}
