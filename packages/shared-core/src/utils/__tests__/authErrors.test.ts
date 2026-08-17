import { describe, it, expect } from 'vitest';
import { loginErrorKey } from '../authErrors.js';

describe('loginErrorKey', () => {
  // Issue #147: none of the credential-shaped failures may be
  // distinguishable from each other, or the UI leaks whether an
  // account exists for the attempted email.
  it.each([
    'auth/invalid-credential',
    'auth/user-not-found',
    'auth/wrong-password',
    'auth/invalid-email',
    'auth/user-disabled',
  ])('collapses %s into the generic invalid-credentials key', (code) => {
    expect(loginErrorKey({ code })).toBe('auth.errorInvalidCredentials');
  });

  it('maps rate limiting to its own key', () => {
    expect(loginErrorKey({ code: 'auth/too-many-requests' })).toBe('auth.errorTooManyAttempts');
  });

  it('never returns a raw error message for unknown failures', () => {
    expect(loginErrorKey(new Error('Firebase: Error (auth/network-request-failed).'))).toBe(
      'auth.errorLoginFailed',
    );
    expect(loginErrorKey(undefined)).toBe('auth.errorLoginFailed');
    expect(loginErrorKey('string error')).toBe('auth.errorLoginFailed');
  });
});
