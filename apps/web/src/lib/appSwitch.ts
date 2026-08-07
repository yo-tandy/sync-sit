/**
 * Where the sibling sync-study app lives. Overridable per environment
 * (.env.development points at the local study dev server); production
 * builds fall back to the deployed origin.
 */
export const STUDY_APP_URL: string =
  import.meta.env.VITE_STUDY_APP_URL ?? 'https://sync-study-app.web.app';
