import { describe, it, expect } from 'vitest';
import { postLoginRouter } from '../postLoginRouter';
import type { SitUser } from '@ejm/sit-core';

const tutorOnlyDoc = { profiles: { tutor: { enrollmentComplete: true } } } as unknown as SitUser;
const emptyDoc = { profiles: {} } as unknown as SitUser;
// issue #435 milestone, PR4: enrollStudentIdentity's root-only shape —
// verified identity, no role profile at all.
const rootOnlyIdentityDoc = { profiles: {}, ejemEmail: 'iris28@ejm.org' } as unknown as SitUser;

describe('postLoginRouter', () => {
  it('routes sit roles to their portals regardless of the doc', () => {
    expect(postLoginRouter('babysitter', tutorOnlyDoc)).toBe('/babysitter');
    expect(postLoginRouter('parent', null)).toBe('/family');
    expect(postLoginRouter('admin')).toBe('/admin');
  });

  it('routes a study tutor with no sit role to /welcome-sit (issue #144)', () => {
    expect(postLoginRouter(undefined, tutorOnlyDoc)).toBe('/welcome-sit');
  });

  it('keeps /signup for users with no profiles at all', () => {
    expect(postLoginRouter(undefined, emptyDoc)).toBe('/signup');
    expect(postLoginRouter(undefined, null)).toBe('/signup');
    expect(postLoginRouter(undefined)).toBe('/signup');
  });

  it('routes a root-only unified-flow identity to /enroll/choose-app (issue #435 PR4)', () => {
    expect(postLoginRouter(undefined, rootOnlyIdentityDoc)).toBe('/enroll/choose-app');
  });
});
