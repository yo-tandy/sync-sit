import { describe, it, expect } from 'vitest';
import {
  schoolYearEnd,
  expectedAgeForGradYear,
  checkEnrollmentAge,
  ageFromDob,
} from '../agePolicy.js';

describe('schoolYearEnd', () => {
  it('is the current year before September', () => {
    expect(schoolYearEnd(new Date('2026-08-04T12:00:00Z'))).toBe(2026);
  });
  it('rolls to next year from September (Paris)', () => {
    expect(schoolYearEnd(new Date('2026-09-01T12:00:00Z'))).toBe(2027);
  });
  it('uses Paris wall clock at the boundary (Aug 31 23:30Z is Sept 1 in Paris)', () => {
    expect(schoolYearEnd(new Date('2026-08-31T23:30:00Z'))).toBe(2027);
  });
});

describe('expectedAgeForGradYear', () => {
  // School year ending 2026: a terminale student (grad 26) is ~18.
  it('terminale ≈ 18', () => {
    expect(expectedAgeForGradYear(26, new Date('2026-03-01T12:00:00Z'))).toBe(18);
  });
  it('seconde ≈ 15 (grad 3 years out)', () => {
    expect(expectedAgeForGradYear(29, new Date('2026-03-01T12:00:00Z'))).toBe(15);
  });
  it('after the September rollover the same grad year implies one year older cohort', () => {
    expect(expectedAgeForGradYear(29, new Date('2026-10-01T12:00:00Z'))).toBe(16);
  });
});

describe('checkEnrollmentAge (dual-signal)', () => {
  const now = new Date('2026-03-01T12:00:00Z'); // school year ends 2026
  it('ok: consistent 16-year-old (grad 28 → expected 16)', () => {
    expect(
      checkEnrollmentAge({ dateOfBirth: new Date('2010-01-15'), graduationYear: 28, now }),
    ).toBe('ok');
  });
  it('ok at tolerance edge: |age − expected| == 1', () => {
    expect(
      checkEnrollmentAge({ dateOfBirth: new Date('2009-01-15'), graduationYear: 28, now }),
    ).toBe('ok'); // age 17, expected 16
  });
  it('under_15 by DOB even when grad year is consistent', () => {
    // grad 29 → expected 15; DOB age 14 → floor fires first
    expect(
      checkEnrollmentAge({ dateOfBirth: new Date('2011-06-15'), graduationYear: 29, now }),
    ).toBe('under_15');
  });
  it('under_15 exactly the day before the 15th birthday', () => {
    expect(
      checkEnrollmentAge({ dateOfBirth: new Date('2011-03-02'), graduationYear: 29, now }),
    ).toBe('under_15');
  });
  it('ok exactly on the 15th birthday', () => {
    expect(
      checkEnrollmentAge({ dateOfBirth: new Date('2011-03-01'), graduationYear: 29, now }),
    ).toBe('ok'); // age 15, expected 15
  });
  it('age_mismatch beyond one class: claims 18 with a grad year implying 15', () => {
    expect(
      checkEnrollmentAge({ dateOfBirth: new Date('2008-01-15'), graduationYear: 29, now }),
    ).toBe('age_mismatch'); // age 18, expected 15
  });
  it('under_15 floor fires before consistency: 14-year-old with a terminale email', () => {
    // DOB age 14, grad 26 → expected 18 (a 4-class gap) — but the under-15
    // floor is evaluated FIRST and is never waivable, so verdict is under_15.
    expect(
      checkEnrollmentAge({ dateOfBirth: new Date('2012-01-15'), graduationYear: 26, now }),
    ).toBe('under_15');
  });
  it('age_mismatch when genuinely too old for the email (≥15 so floor passes)', () => {
    // DOB age 21, grad 26 → expected 18. Floor passes (≥15), consistency fails.
    expect(
      checkEnrollmentAge({ dateOfBirth: new Date('2005-01-15'), graduationYear: 26, now }),
    ).toBe('age_mismatch');
  });
});

describe('ageFromDob', () => {
  const now = new Date('2026-03-01T12:00:00Z');
  it('counts full years elapsed', () => {
    expect(ageFromDob(new Date('2011-01-15'), now)).toBe(15);
  });
  it('is one less the day before the birthday', () => {
    expect(ageFromDob(new Date('2011-03-02'), now)).toBe(14);
  });
  it('increments exactly on the birthday', () => {
    expect(ageFromDob(new Date('2011-03-01'), now)).toBe(15);
  });
  it('matches checkEnrollmentAge floor semantics (Paris wall clock)', () => {
    // 23:30Z on Feb 28 is already Mar 1 00:30 in Paris → birthday reached.
    expect(ageFromDob(new Date('2011-03-01'), new Date('2026-02-28T23:30:00Z'))).toBe(15);
  });
});
