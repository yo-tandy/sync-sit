/**
 * Where the sibling apps live. Overridable per environment (.env.development
 * points at the local dev servers); production builds fall back to the
 * deployed origins. do-web links OUT to both siblings (plan §9.5) — the
 * reverse direction is owner-gated (decision 20, issue #304) and nothing
 * here depends on it.
 */
export const SIT_APP_URL: string = (
  import.meta.env.VITE_SIT_APP_URL ?? 'https://sync-sit.web.app'
).replace(/\/$/, '');

export const STUDY_APP_URL: string = (
  import.meta.env.VITE_STUDY_APP_URL ?? 'https://sync-study-app.web.app'
).replace(/\/$/, '');
