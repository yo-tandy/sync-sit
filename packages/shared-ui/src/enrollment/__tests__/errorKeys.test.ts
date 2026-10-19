import { describe, it, expect } from 'vitest';
import { verifyCodeErrorKey, enrollmentSubmitErrorKey } from '../errorKeys.js';

const fnErr = (code: string, details?: Record<string, unknown>) =>
  Object.assign(new Error('server text'), { code: `functions/${code}`, details });

describe('verifyCodeErrorKey', () => {
  it.each([
    ['invalid-argument', undefined, 'auth.invalidCode'],
    ['not-found', undefined, 'auth.codeExpired'],
    ['deadline-exceeded', undefined, 'auth.codeExpired'],
    ['resource-exhausted', undefined, 'auth.tooManyAttempts'],
    ['failed-precondition', { reason: 'code_identity_class' }, 'auth.codeWrongClass'],
    ['internal', undefined, 'enrollment.serverError'],
    ['permission-denied', undefined, 'enrollment.serverError'],
  ])('%s → its key', (code, details, key) => {
    expect(verifyCodeErrorKey(fnErr(code, details))).toBe(key);
  });

  it('a non-callable error gets the generic key', () => {
    expect(verifyCodeErrorKey(new Error('Network down'))).toBe('enrollment.serverError');
  });
});

describe('enrollmentSubmitErrorKey', () => {
  it.each([
    ['invalid-argument', undefined, 'enrollment.submitInvalid'],
    ['deadline-exceeded', undefined, 'auth.codeExpired'],
    ['resource-exhausted', undefined, 'auth.tooManyAttempts'],
    ['failed-precondition', { reason: 'code_identity_class' }, 'auth.codeWrongClass'],
    // The createUser race backstop stays generic: no account-exists copy (#148).
    ['already-exists', undefined, 'enrollment.serverError'],
    ['internal', undefined, 'enrollment.serverError'],
  ])('%s → its key', (code, details, key) => {
    expect(enrollmentSubmitErrorKey(fnErr(code, details))).toBe(key);
  });

  it('an auth SDK error (post-enroll sign-in) gets the generic key', () => {
    expect(enrollmentSubmitErrorKey({ code: 'auth/network-request-failed' })).toBe('enrollment.serverError');
  });
});
