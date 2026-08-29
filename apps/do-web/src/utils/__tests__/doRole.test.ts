import { describe, it, expect } from 'vitest';
import type { User } from '@ejm/shared-core';
import { getDoRole } from '../doRole';
import { postLoginRouter } from '../postLoginRouter';

/**
 * Role resolution for do-web's portals (plan §13 PR7), mirroring
 * study-core's getStudyRole ordering: provider profile first, then parent,
 * then admin.
 */

const doerDoc = {
  uid: 'd1',
  profiles: { doer: { enrollmentComplete: true } },
} as unknown as User;

const parentDoc = {
  uid: 'p1',
  profiles: { parent: { familyId: 'fam1' } },
} as unknown as User;

const adminDoc = { uid: 'a1', isAdmin: true } as unknown as User;

describe('getDoRole', () => {
  it('resolves doer, parent and admin', () => {
    expect(getDoRole(doerDoc)).toBe('doer');
    expect(getDoRole(parentDoc)).toBe('parent');
    expect(getDoRole(adminDoc)).toBe('admin');
  });

  it('prefers the doer profile when both exist (study ordering)', () => {
    const both = {
      uid: 'b1',
      profiles: { doer: {}, parent: { familyId: 'fam1' } },
    } as unknown as User;
    expect(getDoRole(both)).toBe('doer');
  });

  it('a parent profile without a familyId is not a sync-do parent', () => {
    const noFamily = { uid: 'x', profiles: { parent: {} } } as unknown as User;
    expect(getDoRole(noFamily)).toBeUndefined();
  });

  it('returns undefined for null and role-less docs', () => {
    expect(getDoRole(null)).toBeUndefined();
    expect(getDoRole({ uid: 'n1' } as unknown as User)).toBeUndefined();
  });
});

describe('postLoginRouter', () => {
  it('sends parents to the family portal', () => {
    expect(postLoginRouter(parentDoc)).toBe('/family');
  });

  it('sends doers, admins and role-less accounts to the shell home', () => {
    expect(postLoginRouter(doerDoc)).toBe('/home');
    expect(postLoginRouter(adminDoc)).toBe('/home');
    expect(postLoginRouter(null)).toBe('/home');
  });
});
