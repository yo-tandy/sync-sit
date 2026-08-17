import { describe, it, expect } from 'vitest';
import { postLoginRouter } from '../postLoginRouter';
import type { StudyUser } from '@ejm/study-core';

const babysitterOnlyDoc = { profiles: { babysitter: { enrollmentComplete: true } } } as unknown as StudyUser;
const emptyDoc = { profiles: {} } as unknown as StudyUser;

describe('postLoginRouter (study)', () => {
  it('routes study roles to their portals regardless of the doc', () => {
    expect(postLoginRouter('tutor', babysitterOnlyDoc)).toBe('/tutor');
    expect(postLoginRouter('parent', null)).toBe('/family');
    expect(postLoginRouter('admin')).toBe('/admin');
  });

  it('routes a sit babysitter with no study role to /welcome-study (issue #144)', () => {
    expect(postLoginRouter(undefined, babysitterOnlyDoc)).toBe('/welcome-study');
  });

  it('keeps /signup for users with no profiles at all', () => {
    expect(postLoginRouter(undefined, emptyDoc)).toBe('/signup');
    expect(postLoginRouter(undefined, null)).toBe('/signup');
    expect(postLoginRouter(undefined)).toBe('/signup');
  });
});
