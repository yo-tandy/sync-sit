import { describe, it, expect } from 'vitest';
import { enrollmentErrorReason } from '@ejm/shared-ui';

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
