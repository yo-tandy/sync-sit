import { describe, it, expect } from 'vitest';
import { getFamilyId, hasFamilyMembership } from '../userAdapter.js';
import type { User } from '../user.js';

/**
 * `getFamilyId` exists to resolve membership the same way `hasFamilyMembership`
 * classifies it (PR #345). That agreement is the whole point of the function —
 * a surface that resolves a family differently from the guard that admitted the
 * user is exactly the defect it was added to fix — so it is pinned directly
 * rather than left implied.
 */
const shapes: { name: string; user: unknown; expected: string | null }[] = [
  { name: 'Plan D pointer', user: { profiles: { parent: { familyId: 'fam-d' } } }, expected: 'fam-d' },
  { name: 'legacy Plan C root pointer', user: { familyId: 'fam-c' }, expected: 'fam-c' },
  {
    name: 'root pointer WITH a profile that carries none',
    user: { familyId: 'fam-c', profiles: { parent: { enrollmentComplete: true } } },
    expected: 'fam-c',
  },
  {
    name: 'both present — Plan D wins',
    user: { familyId: 'fam-c', profiles: { parent: { familyId: 'fam-d' } } },
    expected: 'fam-d',
  },
  {
    // The `??`-vs-`||` case: '' is falsy, so the guard falls through to the
    // root pointer and this must too, or the two disagree.
    name: 'EMPTY Plan D pointer falls through to the root',
    user: { familyId: 'fam-c', profiles: { parent: { familyId: '' } } },
    expected: 'fam-c',
  },
  { name: 'empty pointers only', user: { familyId: '', profiles: { parent: { familyId: '' } } }, expected: null },
  { name: 'parent profile, no pointer anywhere', user: { profiles: { parent: { enrollmentComplete: true } } }, expected: null },
  { name: 'no profiles at all', user: {}, expected: null },
  { name: 'null user', user: null, expected: null },
  { name: 'undefined user', user: undefined, expected: null },
];

describe('getFamilyId', () => {
  it.each(shapes)('resolves $name', ({ user, expected }) => {
    expect(getFamilyId(user as User | null | undefined)).toBe(expected);
  });

  it.each(shapes)('agrees with hasFamilyMembership for $name', ({ user }) => {
    const u = user as User | null | undefined;
    expect(getFamilyId(u) !== null).toBe(hasFamilyMembership(u));
  });
});
