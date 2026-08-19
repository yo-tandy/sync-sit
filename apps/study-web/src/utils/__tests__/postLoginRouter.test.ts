import { describe, it, expect } from 'vitest';
import { postLoginRouter, canCrossAppEnrollTutor, crossAppTutorGaps, hasCrossAppTutorGaps } from '../postLoginRouter';
import type { StudyUser } from '@ejm/study-core';

// COMPLETE sit profile: everything enrollTutor's crossApp mode derives.
const babysitterOnlyDoc = {
  firstName: 'Noa', lastName: 'Weiss', dateOfBirth: '2008-03-15',
  profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'noa@ejm.org', classLevel: '2nde', gender: null, contactPhone: '+33 6' } },
} as unknown as StudyUser;
// Sit lets contact be skipped — /welcome-study now collects the gap (issue #203).
const babysitterNoContactDoc = {
  firstName: 'Noa', lastName: 'Weiss', dateOfBirth: '2008-03-15',
  profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'noa@ejm.org', classLevel: '2nde', gender: null } },
} as unknown as StudyUser;
const emptyDoc = { profiles: {} } as unknown as StudyUser;

describe('postLoginRouter (study)', () => {
  it('routes study roles to their portals regardless of the doc', () => {
    expect(postLoginRouter('tutor', babysitterOnlyDoc)).toBe('/tutor');
    expect(postLoginRouter('parent', null)).toBe('/family');
    expect(postLoginRouter('admin')).toBe('/admin');
  });

  it('routes a COMPLETE sit babysitter with no study role to /welcome-study (issue #144)', () => {
    expect(postLoginRouter(undefined, babysitterOnlyDoc)).toBe('/welcome-study');
  });

  it('routes an INCOMPLETE babysitter (missing contact/DOB/classLevel) to /welcome-study too (issue #203)', () => {
    // The one-tap flow now collects the gaps as a supplement — a sit
    // babysitter with a verified EJM identity must NEVER be sent through the
    // classic wizard's school re-verification (StepEmail/StepVerify).
    expect(postLoginRouter(undefined, babysitterNoContactDoc)).toBe('/welcome-study');
    const noDob = {
      firstName: 'Noa', lastName: 'Weiss',
      profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'noa@ejm.org', classLevel: '2nde', gender: null, contactPhone: '+33 6' } },
    } as unknown as StudyUser;
    expect(postLoginRouter(undefined, noDob)).toBe('/welcome-study');
    const abandoned = {
      profiles: { babysitter: { enrollmentComplete: false, ejemEmail: 'noa@ejm.org' } },
    } as unknown as StudyUser;
    expect(postLoginRouter(undefined, abandoned)).toBe('/welcome-study');
  });

  it('only a babysitter doc WITHOUT a verified EJM identity falls back to the classic wizard', () => {
    const noIdentity = {
      firstName: 'Noa', lastName: 'Weiss', dateOfBirth: '2008-03-15',
      profiles: { babysitter: { enrollmentComplete: true, classLevel: '2nde', contactPhone: '+33 6' } },
    } as unknown as StudyUser;
    expect(postLoginRouter(undefined, noIdentity)).toBe('/enroll/tutor');
  });

  it('keeps /signup for users with no profiles at all', () => {
    expect(postLoginRouter(undefined, emptyDoc)).toBe('/signup');
    expect(postLoginRouter(undefined, null)).toBe('/signup');
    expect(postLoginRouter(undefined)).toBe('/signup');
  });
});

describe('canCrossAppEnrollTutor', () => {
  it('is true iff the babysitter profile carries an ejemEmail', () => {
    expect(canCrossAppEnrollTutor(babysitterOnlyDoc)).toBe(true);
    expect(canCrossAppEnrollTutor(babysitterNoContactDoc)).toBe(true);
    expect(canCrossAppEnrollTutor({
      profiles: { babysitter: { enrollmentComplete: true } },
    } as unknown as StudyUser)).toBe(false);
    expect(canCrossAppEnrollTutor({
      profiles: { babysitter: { ejemEmail: '' } },
    } as unknown as StudyUser)).toBe(false);
    expect(canCrossAppEnrollTutor(emptyDoc)).toBe(false);
    expect(canCrossAppEnrollTutor(null)).toBe(false);
  });
});

describe('crossAppTutorGaps (issue #203)', () => {
  it('reports NO gaps for a complete sit profile', () => {
    const gaps = crossAppTutorGaps(babysitterOnlyDoc);
    expect(hasCrossAppTutorGaps(gaps)).toBe(false);
  });

  it('flags exactly the missing fields', () => {
    const gaps = crossAppTutorGaps(babysitterNoContactDoc);
    expect(gaps).toEqual({
      firstName: false, lastName: false, dateOfBirth: false,
      classLevel: false, gender: false, contact: true,
    });
    expect(hasCrossAppTutorGaps(gaps)).toBe(true);
  });

  it('any single contact channel satisfies the contact gap', () => {
    for (const field of ['contactEmail', 'contactPhone', 'whatsapp']) {
      const doc = {
        firstName: 'N', lastName: 'W', dateOfBirth: '2008-03-15',
        profiles: { babysitter: { ejemEmail: 'n@ejm.org', classLevel: '2nde', gender: null, [field]: 'x' } },
      } as unknown as StudyUser;
      expect(crossAppTutorGaps(doc).contact).toBe(false);
    }
  });

  it('gender null (answered "no answer" in sit) is NOT a gap; only an absent field is', () => {
    expect(crossAppTutorGaps(babysitterOnlyDoc).gender).toBe(false);
    const neverAsked = {
      firstName: 'N', lastName: 'W', dateOfBirth: '2008-03-15',
      profiles: { babysitter: { ejemEmail: 'n@ejm.org', contactPhone: '+33 6' } },
    } as unknown as StudyUser;
    const gaps = crossAppTutorGaps(neverAsked);
    expect(gaps.gender).toBe(true);
    expect(gaps.classLevel).toBe(true);
  });

  it('a degenerate doc reports every gap', () => {
    const bare = {
      profiles: { babysitter: { ejemEmail: 'n@ejm.org' } },
    } as unknown as StudyUser;
    expect(crossAppTutorGaps(bare)).toEqual({
      firstName: true, lastName: true, dateOfBirth: true,
      classLevel: true, gender: true, contact: true,
    });
  });
});
