import { describe, it, expect } from 'vitest';
import {
  tutorEnrollmentSchema,
  tutorImmutableProfileSchema,
  tutorSessionPrefsSchema,
} from '../tutor.js';

const validEnrollment = {
  firstName: 'Flow',
  lastName: 'Tutor',
  dateOfBirth: '2008-07-07',
  classLevel: 'Terminale',
  gender: 'other' as const,
  subjects: [],
  sessionLengthsMin: [60],
  locationPrefs: ['online'],
  paddingMin: 0,
  areaMode: 'arrondissement' as const,
  contactEmail: 'flow@ejm.org',
};

describe('tutorEnrollmentSchema', () => {
  it('accepts a valid full enrollment payload', () => {
    expect(tutorEnrollmentSchema.safeParse(validEnrollment).success).toBe(true);
  });

  it('accepts an empty subjects array (deferred to profile edit)', () => {
    expect(tutorEnrollmentSchema.safeParse({ ...validEnrollment, subjects: [] }).success).toBe(true);
  });

  it('rejects a missing required immutable field', () => {
    const { firstName: _omit, ...rest } = validEnrollment;
    expect(tutorEnrollmentSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an invalid session length', () => {
    expect(
      tutorEnrollmentSchema.safeParse({ ...validEnrollment, sessionLengthsMin: [50] }).success,
    ).toBe(false);
  });

  it('rejects an empty session-lengths array', () => {
    expect(
      tutorEnrollmentSchema.safeParse({ ...validEnrollment, sessionLengthsMin: [] }).success,
    ).toBe(false);
  });

  it('rejects an empty location-prefs array', () => {
    expect(
      tutorEnrollmentSchema.safeParse({ ...validEnrollment, locationPrefs: [] }).success,
    ).toBe(false);
  });

  it('rejects an out-of-range transit padding', () => {
    expect(tutorEnrollmentSchema.safeParse({ ...validEnrollment, paddingMin: 90 }).success).toBe(false);
  });

  it('rejects an unknown location preference', () => {
    expect(
      tutorEnrollmentSchema.safeParse({ ...validEnrollment, locationPrefs: ['spaceship'] }).success,
    ).toBe(false);
  });
});

describe('tutorImmutableProfileSchema', () => {
  it('requires firstName/lastName/dateOfBirth/classLevel', () => {
    expect(tutorImmutableProfileSchema.safeParse({}).success).toBe(false);
    expect(
      tutorImmutableProfileSchema.safeParse({
        firstName: 'A', lastName: 'B', dateOfBirth: '2008-01-01', classLevel: '1ère',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown gender value', () => {
    expect(
      tutorImmutableProfileSchema.safeParse({
        firstName: 'A', lastName: 'B', dateOfBirth: '2008-01-01', classLevel: '1ère', gender: 'robot',
      }).success,
    ).toBe(false);
  });
});

describe('tutorSessionPrefsSchema', () => {
  it('accepts each valid session length', () => {
    for (const len of [30, 45, 60, 75]) {
      expect(
        tutorSessionPrefsSchema.safeParse({
          sessionLengthsMin: [len], locationPrefs: ['library'], paddingMin: 0, areaMode: 'distance',
        }).success,
      ).toBe(true);
    }
  });
});
