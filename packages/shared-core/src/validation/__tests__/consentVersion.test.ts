import { describe, expect, it } from 'vitest';
import {
  consentVersionSchema,
  familyEnrollmentSchema,
  studentIdentityEnrollmentSchema,
} from '../enrollment.js';
import { CONSENT_VERSION, CONSENT_VERSIONS } from '../../constants/config.js';

// Issue #415 decision 2: consentVersionSchema replaced the old
// z.enum(['1.0', '2025-12-01']) allowlist with a shape check, precisely so
// already-shipped versions from every app stay valid without an enum edit,
// while junk still gets rejected.
describe('consentVersionSchema', () => {
  it.each([
    ['1.0', "the shared constants' dotted scheme"],
    ['2025-12-01', "study's already-shipped dated label"],
    ['2026-08-28', "do's already-shipped dated label"],
    ['10.42', 'a future dotted bump'],
    ['2030-01-15', 'a future dated bump'],
  ])('accepts %s (%s)', (value) => {
    expect(consentVersionSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['v1', 'not the dotted or dated shape'],
    ['', 'empty string'],
    ['1', 'missing the second dotted segment'],
    ['1.0.0', 'three dotted segments, not two'],
  ])('rejects %s (%s)', (value) => {
    expect(consentVersionSchema.safeParse(value).success).toBe(false);
  });

  // The shape regex is deliberately not a calendar validator — an
  // out-of-range month still matches \d{4}-\d{2}-\d{2}. Documented here as
  // an intentional non-goal, not a gap: a real calendar bump only ever comes
  // from a maintainer editing constants/config.ts, not untrusted input.
  it('accepts a syntactically dated string even with an invalid calendar month', () => {
    expect(consentVersionSchema.safeParse('2025-13-01').success).toBe(true);
  });

  it('is optional on familyEnrollmentSchema and still shape-checked when present', () => {
    const base = {
      familyName: 'Durand',
      firstName: 'Claire',
      address: '10 Rue Cler, 75007 Paris',
    };
    expect(familyEnrollmentSchema.safeParse(base).success).toBe(true);
    expect(
      familyEnrollmentSchema.safeParse({ ...base, consentVersion: CONSENT_VERSION }).success,
    ).toBe(true);
    // Already-stored study/do labels must keep validating even though no
    // client sends them anymore — the audit trail is never rewritten.
    expect(
      familyEnrollmentSchema.safeParse({ ...base, consentVersion: '2025-12-01' }).success,
    ).toBe(true);
    expect(familyEnrollmentSchema.safeParse({ ...base, consentVersion: 'v1' }).success).toBe(
      false,
    );
  });

  it('is required and shape-checked on studentIdentityEnrollmentSchema', () => {
    const base = {
      ejemEmail: 'a@ejm.org',
      verificationCode: '123456',
      password: 'Password1',
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: '2010-01-01',
      classLevel: 'Terminale',
      gender: 'other',
    } as const;
    expect(
      studentIdentityEnrollmentSchema.safeParse({ ...base, consentVersion: CONSENT_VERSION })
        .success,
    ).toBe(true);
    expect(
      studentIdentityEnrollmentSchema.safeParse({ ...base, consentVersion: '' }).success,
    ).toBe(false);
    expect(
      studentIdentityEnrollmentSchema.safeParse({ ...base, consentVersion: 'v1' }).success,
    ).toBe(false);
  });
});

describe('CONSENT_VERSION / CONSENT_VERSIONS', () => {
  it('CONSENT_VERSION is the current TOS_VERSION and passes its own shape check', () => {
    expect(CONSENT_VERSION).toBe(CONSENT_VERSIONS.tos);
    expect(consentVersionSchema.safeParse(CONSENT_VERSION).success).toBe(true);
  });

  it('CONSENT_VERSIONS bundles all three current document versions', () => {
    expect(Object.keys(CONSENT_VERSIONS).sort()).toEqual(['privacy', 'supervision', 'tos']);
  });
});
