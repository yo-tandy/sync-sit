import { describe, it, expect } from 'vitest';
import { postLoginRouter } from '../postLoginRouter';
import type { StudyUser } from '@ejm/study-core';

// COMPLETE sit profile: everything enrollTutor's crossApp mode derives.
const babysitterOnlyDoc = {
  firstName: 'Noa', lastName: 'Weiss', dateOfBirth: '2008-03-15',
  profiles: { babysitter: { enrollmentComplete: true, classLevel: '2nde', contactPhone: '+33 6' } },
} as unknown as StudyUser;
// INCOMPLETE: sit lets contact be skipped — crossApp would dead-end.
const babysitterNoContactDoc = {
  firstName: 'Noa', lastName: 'Weiss', dateOfBirth: '2008-03-15',
  profiles: { babysitter: { enrollmentComplete: true, classLevel: '2nde' } },
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

  it('routes an INCOMPLETE sit babysitter to the classic wizard, not the one-tap dead-end', () => {
    // enrollTutor crossApp derives classLevel + contact + identity from the
    // sit profile; sit guarantees none of them. Missing anything -> the
    // classic wizard collects exactly the missing pieces.
    expect(postLoginRouter(undefined, babysitterNoContactDoc)).toBe('/enroll/tutor');
    const abandoned = { profiles: { babysitter: { enrollmentComplete: false } } } as unknown as StudyUser;
    expect(postLoginRouter(undefined, abandoned)).toBe('/enroll/tutor');
  });

  it('keeps /signup for users with no profiles at all', () => {
    expect(postLoginRouter(undefined, emptyDoc)).toBe('/signup');
    expect(postLoginRouter(undefined, null)).toBe('/signup');
    expect(postLoginRouter(undefined)).toBe('/signup');
  });
});
