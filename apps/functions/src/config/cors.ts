/**
 * CORS configuration for Cloud Functions.
 * In the emulator, allow all origins. In production, restrict to the app domains.
 */
export function getCorsOrigin(): string[] | boolean {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return true; // Allow all in development
  }
  return [
    'https://sync-sit.web.app',
    'https://sync-sit.com',
    'https://www.sync-sit.com',
  ];
}
