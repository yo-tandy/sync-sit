/**
 * CORS configuration for Cloud Functions.
 */
export function getCorsOrigin(): boolean {
  // Allow all origins — the functions are protected by Firebase Auth,
  // so CORS restriction provides minimal additional security.
  return true;
}
