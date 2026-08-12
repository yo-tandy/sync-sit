import { describe, it, expect } from 'vitest';
import { enrollmentErrorReason, ageGateErrorCode } from '@ejm/shared-ui';

describe('enrollmentErrorReason', () => {
  it('extracts account-exists', () => {
    expect(enrollmentErrorReason({ code: 'functions/already-exists', details: { reason: 'account-exists' } }))
      .toBe('account-exists');
  });
  it('extracts profile-exists', () => {
    expect(enrollmentErrorReason({ details: { reason: 'profile-exists', profile: 'tutor' } }))
      .toBe('profile-exists');
  });
  it('returns null for plain errors and non-errors', () => {
    expect(enrollmentErrorReason(new Error('boom'))).toBeNull();
    expect(enrollmentErrorReason(null)).toBeNull();
    expect(enrollmentErrorReason({ details: { reason: 'other' } })).toBeNull();
  });
});

describe('enrollmentErrorReason role-exclusive', () => {
  it('recognizes the role-exclusive reason (issue #116 guard)', () => {
    expect(enrollmentErrorReason({ details: { reason: 'role-exclusive', profile: 'parent' } }))
      .toBe('role-exclusive');
  });
});

describe('ageGateErrorCode', () => {
  it('extracts age/under-15', () => {
    expect(ageGateErrorCode({ code: 'functions/failed-precondition', details: { code: 'age/under-15' } }))
      .toBe('age/under-15');
  });
  it('extracts age/mismatch', () => {
    expect(ageGateErrorCode({ details: { code: 'age/mismatch' } })).toBe('age/mismatch');
  });
  it('returns null for plain errors, non-errors, and other codes', () => {
    expect(ageGateErrorCode(new Error('boom'))).toBeNull();
    expect(ageGateErrorCode(null)).toBeNull();
    expect(ageGateErrorCode({ details: { code: 'other' } })).toBeNull();
    expect(ageGateErrorCode({ details: { reason: 'account-exists' } })).toBeNull();
  });
});
