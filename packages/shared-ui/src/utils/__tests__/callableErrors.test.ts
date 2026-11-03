import { describe, it, expect } from 'vitest';
import { endorsementCooldownDetails, verificationCodeError } from '../callableErrors.js';

describe('endorsementCooldownDetails', () => {
  it('extracts code and a parsed retryAt Date', () => {
    const result = endorsementCooldownDetails({
      code: 'functions/failed-precondition',
      details: { code: 'endorsement/cooldown', retryAt: '2026-10-11T00:00:00.000Z' },
    });
    expect(result).toEqual({
      code: 'endorsement/cooldown',
      retryAt: new Date('2026-10-11T00:00:00.000Z'),
    });
  });

  it('returns null for plain errors, non-errors, and other codes', () => {
    expect(endorsementCooldownDetails(new Error('boom'))).toBeNull();
    expect(endorsementCooldownDetails(null)).toBeNull();
    expect(endorsementCooldownDetails({ details: { code: 'age/under-15' } })).toBeNull();
    expect(endorsementCooldownDetails({ details: { reason: 'already_endorsed' } })).toBeNull();
  });

  it('returns null when retryAt is missing or unparsable', () => {
    expect(endorsementCooldownDetails({ details: { code: 'endorsement/cooldown' } })).toBeNull();
    expect(
      endorsementCooldownDetails({ details: { code: 'endorsement/cooldown', retryAt: 'not-a-date' } }),
    ).toBeNull();
    expect(
      endorsementCooldownDetails({ details: { code: 'endorsement/cooldown', retryAt: 12345 } }),
    ).toBeNull();
  });
});

describe('verificationCodeError', () => {
  const fnErr = (code: string) => Object.assign(new Error('server text'), { code });

  it('maps a missing or expired code to expired', () => {
    expect(verificationCodeError(fnErr('functions/not-found'))).toBe('expired');
    expect(verificationCodeError(fnErr('functions/deadline-exceeded'))).toBe('expired');
  });

  it('maps resource-exhausted to too-many-attempts', () => {
    expect(verificationCodeError(fnErr('functions/resource-exhausted'))).toBe('too-many-attempts');
  });

  it('maps the code_identity_class reason to wrong-class', () => {
    const err = Object.assign(new Error('server text'), {
      code: 'functions/failed-precondition',
      details: { reason: 'code_identity_class' },
    });
    expect(verificationCodeError(err)).toBe('wrong-class');
  });

  it('leaves invalid-argument, internal and non-callable errors unmapped', () => {
    expect(verificationCodeError(fnErr('functions/invalid-argument'))).toBeNull();
    expect(verificationCodeError(fnErr('functions/internal'))).toBeNull();
    expect(verificationCodeError(new Error('boom'))).toBeNull();
    expect(verificationCodeError(null)).toBeNull();
  });
});
