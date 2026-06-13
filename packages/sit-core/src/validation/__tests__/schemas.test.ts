import { describe, it, expect } from 'vitest';
import {
  ejemEmailSchema,
  verificationCodeSchema,
  passwordSchema,
} from '../auth.js';
import {
  strongPasswordSchema,
  checkPasswordRequirements,
  babysitterPreferencesSchema,
  familyEnrollmentSchema,
  isBabysitterProfileComplete,
} from '../enrollment.js';

describe('ejemEmailSchema', () => {
  it('accepts valid @ejm.org email', () => {
    expect(ejemEmailSchema.safeParse('student28@ejm.org').success).toBe(true);
  });

  it('rejects non-EJM domain', () => {
    expect(ejemEmailSchema.safeParse('user@gmail.com').success).toBe(false);
  });

  it('rejects invalid email format', () => {
    expect(ejemEmailSchema.safeParse('notanemail').success).toBe(false);
  });
});

describe('verificationCodeSchema', () => {
  it('accepts 6-digit string', () => {
    expect(verificationCodeSchema.safeParse('123456').success).toBe(true);
  });

  it('rejects 5-digit string', () => {
    expect(verificationCodeSchema.safeParse('12345').success).toBe(false);
  });

  it('rejects letters', () => {
    expect(verificationCodeSchema.safeParse('12345a').success).toBe(false);
  });

  it('rejects 7-digit string', () => {
    expect(verificationCodeSchema.safeParse('1234567').success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('accepts 8+ character password', () => {
    expect(passwordSchema.safeParse('password').success).toBe(true);
  });

  it('rejects under 8 characters', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
  });
});

describe('strongPasswordSchema', () => {
  it('accepts password with lowercase, uppercase, and number', () => {
    expect(strongPasswordSchema.safeParse('Passw0rd').success).toBe(true);
  });

  it('rejects password without uppercase', () => {
    expect(strongPasswordSchema.safeParse('passw0rd').success).toBe(false);
  });

  it('rejects password without lowercase', () => {
    expect(strongPasswordSchema.safeParse('PASSW0RD').success).toBe(false);
  });

  it('rejects password without number', () => {
    expect(strongPasswordSchema.safeParse('Password').success).toBe(false);
  });

  it('rejects password under 8 chars', () => {
    expect(strongPasswordSchema.safeParse('Pa1').success).toBe(false);
  });
});

describe('checkPasswordRequirements', () => {
  it('returns all true for strong password', () => {
    expect(checkPasswordRequirements('Passw0rd')).toEqual({
      minLength: true,
      hasLowercase: true,
      hasUppercase: true,
      hasNumber: true,
    });
  });

  it('returns individual flags correctly', () => {
    expect(checkPasswordRequirements('abc')).toEqual({
      minLength: false,
      hasLowercase: true,
      hasUppercase: false,
      hasNumber: false,
    });
  });
});

describe('babysitterPreferencesSchema', () => {
  const validPrefs = {
    kidAgeMin: 3,
    kidAgeMax: 12,
    maxKids: 3,
    hourlyRate: 15,
    contactEmail: 'test@ejm.org',
    areaMode: 'arrondissement' as const,
    arrondissements: ['16e'],
  };

  it('accepts valid preferences with email', () => {
    expect(babysitterPreferencesSchema.safeParse(validPrefs).success).toBe(true);
  });

  it('accepts preferences with phone instead of email', () => {
    const { contactEmail, ...rest } = validPrefs;
    expect(
      babysitterPreferencesSchema.safeParse({
        ...rest,
        contactPhone: '+33612345678',
      }).success
    ).toBe(true);
  });

  it('rejects when no contact method provided', () => {
    const { contactEmail, ...noContact } = validPrefs;
    expect(babysitterPreferencesSchema.safeParse(noContact).success).toBe(false);
  });

  it('rejects when kidAgeMin > kidAgeMax', () => {
    expect(
      babysitterPreferencesSchema.safeParse({
        ...validPrefs,
        kidAgeMin: 12,
        kidAgeMax: 3,
      }).success
    ).toBe(false);
  });
});

describe('familyEnrollmentSchema', () => {
  it('accepts valid enrollment data', () => {
    expect(
      familyEnrollmentSchema.safeParse({
        familyName: 'Dupont',
        firstName: 'Marie',
        address: '15 Rue de Passy, 75016 Paris',
      }).success
    ).toBe(true);
  });

  it('rejects missing familyName', () => {
    expect(
      familyEnrollmentSchema.safeParse({
        firstName: 'Marie',
        address: '15 Rue de Passy',
      }).success
    ).toBe(false);
  });

  it('rejects missing firstName', () => {
    expect(
      familyEnrollmentSchema.safeParse({
        familyName: 'Dupont',
        address: '15 Rue de Passy',
      }).success
    ).toBe(false);
  });

  it('rejects missing address', () => {
    expect(
      familyEnrollmentSchema.safeParse({
        familyName: 'Dupont',
        firstName: 'Marie',
      }).success
    ).toBe(false);
  });
});

describe('isBabysitterProfileComplete', () => {
  it('returns true for complete profile', () => {
    expect(
      isBabysitterProfileComplete({
        languages: ['French'],
        kidAgeRange: { min: 3, max: 12 },
        maxKids: 3,
        hourlyRate: 15,
        areaMode: 'arrondissement',
        arrondissements: ['16e'],
      })
    ).toBe(true);
  });

  it('returns false when missing languages', () => {
    expect(
      isBabysitterProfileComplete({
        kidAgeRange: { min: 3, max: 12 },
        maxKids: 3,
        hourlyRate: 15,
        areaMode: 'arrondissement',
        arrondissements: ['16e'],
      })
    ).toBe(false);
  });

  it('returns false when missing hourlyRate', () => {
    expect(
      isBabysitterProfileComplete({
        languages: ['French'],
        kidAgeRange: { min: 3, max: 12 },
        maxKids: 3,
        areaMode: 'arrondissement',
        arrondissements: ['16e'],
      })
    ).toBe(false);
  });

  it('returns false for distance mode without address', () => {
    expect(
      isBabysitterProfileComplete({
        languages: ['French'],
        kidAgeRange: { min: 3, max: 12 },
        maxKids: 3,
        hourlyRate: 15,
        areaMode: 'distance',
      })
    ).toBe(false);
  });
});
