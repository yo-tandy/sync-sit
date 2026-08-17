/**
 * Maps a Firebase Auth sign-in failure to an i18n message key.
 *
 * Credential-shaped failures (wrong password, unknown email, malformed
 * email) all collapse into one generic key so the UI never reveals
 * whether an account exists for a given address (issue #147).
 */
export function loginErrorKey(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-email':
    case 'auth/user-disabled':
      return 'auth.errorInvalidCredentials';
    case 'auth/too-many-requests':
      return 'auth.errorTooManyAttempts';
    default:
      return 'auth.errorLoginFailed';
  }
}
