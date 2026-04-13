import { describe, it, expect } from 'vitest';
import { validateEjmEmail, isOldEnough } from '../ejm-email.js';

describe('validateEjmEmail', () => {
  // Use a fixed date in March 2026 — valid years are 26, 27, 28, 29
  const march2026 = new Date('2026-03-15');

  it('accepts a valid current-year EJM email', () => {
    const result = validateEjmEmail('student28@ejm.org', march2026);
    expect(result).toEqual({ valid: true, graduationYear: 28 });
  });

  it('accepts email with earliest valid year', () => {
    const result = validateEjmEmail('student26@ejm.org', march2026);
    expect(result).toEqual({ valid: true, graduationYear: 26 });
  });

  it('accepts email with latest valid year', () => {
    const result = validateEjmEmail('student29@ejm.org', march2026);
    expect(result).toEqual({ valid: true, graduationYear: 29 });
  });

  it('rejects non-EJM domain', () => {
    const result = validateEjmEmail('student28@gmail.com', march2026);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('@ejm.org');
  });

  it('rejects expired graduation year', () => {
    const result = validateEjmEmail('student25@ejm.org', march2026);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not currently valid');
  });

  it('rejects future graduation year beyond range', () => {
    const result = validateEjmEmail('student30@ejm.org', march2026);
    expect(result.valid).toBe(false);
  });

  it('rejects email with too-short local part', () => {
    const result = validateEjmEmail('ab@ejm.org', march2026);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid EJM email format');
  });

  it('rejects email with non-numeric suffix', () => {
    const result = validateEjmEmail('studentAB@ejm.org', march2026);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('graduation year');
  });

  it('is case-insensitive', () => {
    const result = validateEjmEmail('Student28@EJM.ORG', march2026);
    expect(result.valid).toBe(true);
  });

  it('trims whitespace', () => {
    const result = validateEjmEmail('  student28@ejm.org  ', march2026);
    expect(result.valid).toBe(true);
  });

  describe('September rollover', () => {
    const oct2026 = new Date('2026-10-01');
    // After Sep 1 2026: valid years shift to 27, 28, 29, 30

    it('rejects current year after September (school year ended)', () => {
      const result = validateEjmEmail('student26@ejm.org', oct2026);
      expect(result.valid).toBe(false);
    });

    it('accepts next year after September', () => {
      const result = validateEjmEmail('student27@ejm.org', oct2026);
      expect(result.valid).toBe(true);
    });

    it('accepts latest valid year after September', () => {
      const result = validateEjmEmail('student30@ejm.org', oct2026);
      expect(result.valid).toBe(true);
    });
  });
});

describe('isOldEnough', () => {
  const now = new Date('2026-06-15');

  it('returns true for exactly 15 years old', () => {
    const dob = new Date('2011-06-15');
    expect(isOldEnough(dob, 15, now)).toBe(true);
  });

  it('returns false for 14 years old', () => {
    const dob = new Date('2012-01-01');
    expect(isOldEnough(dob, 15, now)).toBe(false);
  });

  it('returns true for 16 years old', () => {
    const dob = new Date('2010-01-01');
    expect(isOldEnough(dob, 15, now)).toBe(true);
  });

  it('handles birthday not yet occurred this year', () => {
    // Born Dec 15, 2011 — on June 15, 2026 they are still 14
    const dob = new Date('2011-12-15');
    expect(isOldEnough(dob, 15, now)).toBe(false);
  });

  it('uses default minAge of 15', () => {
    const dob = new Date('2011-06-15');
    expect(isOldEnough(dob, undefined, now)).toBe(true);
  });
});
