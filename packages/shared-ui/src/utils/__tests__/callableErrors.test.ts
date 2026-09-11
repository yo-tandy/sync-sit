import { describe, it, expect } from 'vitest';
import { endorsementCooldownDetails } from '../callableErrors.js';

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
