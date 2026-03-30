/**
 * CORS configuration for Cloud Functions.
 * In the emulator, allow all origins. In production, restrict to the app domain.
 */
export function getCorsOrigin(): string | boolean {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return true; // Allow all in development
  }
  // In production, set ALLOWED_ORIGIN in Firebase Functions config
  // e.g. firebase functions:config:set app.origin="https://ejm-babysitter.web.app"
  return process.env.ALLOWED_ORIGIN || 'https://ejm-babysitter.web.app';
}
