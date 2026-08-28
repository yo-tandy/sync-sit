import { describe, it, expect } from 'vitest';
import { hasFamilyMembership } from '../userAdapter.js';
import type { User } from '../user.js';

/**
 * Load-bearing predicate (issue #279): four client guard sites gate the
 * orphan re-attach path on it, and it must mirror addProfileToUser's
 * server-side orphan classification -- EITHER membership field counts.
 * The study ParentEnrollment suite hand-mocks it, so this direct pin is
 * what catches drift between the mirror and the real thing.
 */
describe('hasFamilyMembership', () => {
  it('Plan D pointer set -> member', () => {
    const u = { profiles: { parent: { enrollmentComplete: true, familyId: 'fam-1' } } };
    expect(hasFamilyMembership(u as unknown as User)).toBe(true);
  });

  it('legacy Plan C root familyId set (none on the profile) -> member', () => {
    const u = { familyId: 'fam-legacy', profiles: { parent: { enrollmentComplete: true } } };
    expect(hasFamilyMembership(u as unknown as User)).toBe(true);
  });

  it('legacy root familyId with NO parent profile -> member (server rejects that join too, round 7)', () => {
    expect(hasFamilyMembership({ familyId: 'fam-legacy', profiles: {} } as unknown as User)).toBe(true);
  });

  it('neither field (orphan profile), no fields at all, and null all -> not a member', () => {
    expect(hasFamilyMembership({ profiles: { parent: { enrollmentComplete: true } } } as unknown as User)).toBe(false);
    expect(hasFamilyMembership({ profiles: {} } as unknown as User)).toBe(false);
    expect(hasFamilyMembership(null)).toBe(false);
    expect(hasFamilyMembership(undefined)).toBe(false);
  });
});
