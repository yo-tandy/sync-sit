import { describe, it, expect } from 'vitest';
import {
  tutorEnrollmentSchema,
  tutorImmutableProfileSchema,
  tutorSessionPrefsSchema,
  withPrefDefaults,
} from '../tutor.js';

const validEnrollment = {
  firstName: 'Flow',
  lastName: 'Tutor',
  dateOfBirth: '2008-07-07',
  classLevel: 'Terminale',
  gender: 'other' as const,
  subjects: [{ subject: 'math', levels: ['6e'], rate: 25 }],
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

  it('rejects an empty subjects array — enrollment must produce a searchable tutor', () => {
    expect(tutorEnrollmentSchema.safeParse({ ...validEnrollment, subjects: [] }).success).toBe(false);
  });

  it('rejects a zero rate (must be positive, matching the wizard gate)', () => {
    const subj = { subject: 'math', levels: ['6e'], rate: 0 };
    expect(tutorEnrollmentSchema.safeParse({ ...validEnrollment, subjects: [subj] }).success).toBe(false);
  });

  it('accepts a payload with the identity fields absent (issue #144: cross-app add-profile omits them; presence is a callable-level check)', () => {
    const { firstName: _f, lastName: _l, dateOfBirth: _d, ...rest } = validEnrollment;
    expect(tutorEnrollmentSchema.safeParse(rest).success).toBe(true);
  });

  it('still rejects EMPTY identity strings when sent', () => {
    expect(tutorEnrollmentSchema.safeParse({ ...validEnrollment, firstName: '' }).success).toBe(false);
    expect(tutorEnrollmentSchema.safeParse({ ...validEnrollment, dateOfBirth: '' }).success).toBe(false);
  });

  it('rejects a missing classLevel (still required)', () => {
    const { classLevel: _omit, ...rest } = validEnrollment;
    expect(tutorEnrollmentSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an invalid session length', () => {
    expect(
      tutorEnrollmentSchema.safeParse({ ...validEnrollment, sessionLengthsMin: [50] }).success,
    ).toBe(false);
  });

  it('rejects an explicit empty session-lengths array', () => {
    expect(
      tutorEnrollmentSchema.safeParse({ ...validEnrollment, sessionLengthsMin: [] }).success,
    ).toBe(false);
  });

  it('rejects an explicit empty location-prefs array', () => {
    expect(
      tutorEnrollmentSchema.safeParse({ ...validEnrollment, locationPrefs: [] }).success,
    ).toBe(false);
  });

  it('rejects an out-of-range appointment padding', () => {
    expect(tutorEnrollmentSchema.safeParse({ ...validEnrollment, paddingMin: 90 }).success).toBe(false);
  });

  it('accepts a payload with no pref fields at all (wizard no longer sends them)', () => {
    const {
      sessionLengthsMin: _sl,
      locationPrefs: _lp,
      paddingMin: _pm,
      areaMode: _am,
      ...noPrefs
    } = validEnrollment;
    expect(tutorEnrollmentSchema.safeParse(noPrefs).success).toBe(true);
  });

  it('rejects an unknown location preference', () => {
    expect(
      tutorEnrollmentSchema.safeParse({ ...validEnrollment, locationPrefs: ['spaceship'] }).success,
    ).toBe(false);
  });
});

describe('tutorImmutableProfileSchema', () => {
  it('requires classLevel; identity fields are optional (issue #144)', () => {
    expect(tutorImmutableProfileSchema.safeParse({}).success).toBe(false);
    expect(tutorImmutableProfileSchema.safeParse({ classLevel: '1ère' }).success).toBe(true);
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

describe('withPrefDefaults', () => {
  const parse = (payload: unknown) => {
    const result = tutorEnrollmentSchema.safeParse(payload);
    if (!result.success) throw new Error('fixture must parse');
    return result.data;
  };

  it('defaults every absent pref field to the server defaults', () => {
    const {
      sessionLengthsMin: _sl,
      locationPrefs: _lp,
      paddingMin: _pm,
      areaMode: _am,
      ...noPrefs
    } = validEnrollment;
    const defaulted = withPrefDefaults(parse(noPrefs));
    expect(defaulted.sessionLengthsMin).toEqual([60]);
    // Online-only: a 15-18-year-old is never opted into in-person-at-a-home
    // options by a default.
    expect(defaulted.locationPrefs).toEqual(['online']);
    expect(defaulted.paddingMin).toBe(30);
    expect(defaulted.areaMode).toBe('arrondissement');
    expect(defaulted.arrondissements).toEqual([]);
  });

  it('never overrides pref fields that were sent', () => {
    const defaulted = withPrefDefaults(
      parse({
        ...validEnrollment,
        sessionLengthsMin: [45, 75],
        locationPrefs: ['library'],
        paddingMin: 0,
        areaMode: 'distance',
        arrondissements: ['75005'],
      }),
    );
    expect(defaulted.sessionLengthsMin).toEqual([45, 75]);
    expect(defaulted.locationPrefs).toEqual(['library']);
    expect(defaulted.paddingMin).toBe(0);
    expect(defaulted.areaMode).toBe('distance');
    expect(defaulted.arrondissements).toEqual(['75005']);
  });

  it('preserves non-pref fields untouched', () => {
    const defaulted = withPrefDefaults(parse(validEnrollment));
    expect(defaulted.firstName).toBe('Flow');
    expect(defaulted.contactEmail).toBe('flow@ejm.org');
  });
});

import { toDobDate } from '../../enrollment/enrollTutor.js';

describe('toDobDate — the stored-DOB normalizer the age gate depends on', () => {
  it('parses the sit-created string format', () => {
    const d = toDobDate('2008-05-01');
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBe(2008);
  });

  it('unwraps a Firestore Timestamp-like object', () => {
    const ts = { toDate: () => new Date(2009, 2, 15) };
    const d = toDobDate(ts);
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBe(2009);
  });

  it('returns null for empty string, null, undefined and junk', () => {
    expect(toDobDate('')).toBeNull();
    expect(toDobDate(null)).toBeNull();
    expect(toDobDate(undefined)).toBeNull();
    expect(toDobDate(42)).toBeNull();
  });
});
