import { describe, it, expect } from 'vitest';
import {
  buildMigrationUpdate,
  buildProfile,
  BABYSITTER_KEYS,
  type LegacyUserDoc,
} from '../migrateUsersToProfiles.logic.js';

describe('buildMigrationUpdate', () => {
  it('returns null for an already-migrated doc (no top-level role)', () => {
    expect(buildMigrationUpdate({})).toBeNull();
    expect(
      buildMigrationUpdate({ profiles: { babysitter: {} } } as unknown as LegacyUserDoc),
    ).toBeNull();
  });

  it('lifts a legacy babysitter into profiles.babysitter and deletes flat fields', () => {
    const legacy: LegacyUserDoc = {
      role: 'babysitter',
      enrollmentComplete: true,
      ejemEmail: 'b@ejm.org',
      classLevel: 'Terminale',
      gender: 'female',
      languages: ['fr', 'en'],
      hourlyRate: 18,
      kidAgeRange: { min: 2, max: 10 },
      maxKids: 3,
      searchable: true,
      approvedFamilies: ['famA'],
      areaMode: 'arrondissement',
      arrondissements: ['75001'],
    };

    const plan = buildMigrationUpdate(legacy)!;
    const profile = plan.set['profiles.babysitter'] as Record<string, unknown>;

    expect(profile.enrollmentComplete).toBe(true);
    expect(profile.ejemEmail).toBe('b@ejm.org');
    expect(profile.classLevel).toBe('Terminale');
    expect(profile.hourlyRate).toBe(18);
    expect(profile.kidAgeRange).toEqual({ min: 2, max: 10 });
    expect(profile.searchable).toBe(true);
    expect(profile.approvedFamilies).toEqual(['famA']);

    // role + every babysitter flat key + enrollmentComplete must be deleted
    expect(plan.deleteFields).toContain('role');
    expect(plan.deleteFields).toContain('enrollmentComplete');
    expect(plan.deleteFields).toContain('searchable');
    expect(plan.deleteFields).toContain('approvedFamilies');
    for (const key of BABYSITTER_KEYS) {
      expect(plan.deleteFields).toContain(key);
    }
  });

  it('defaults enrollmentComplete to false when a babysitter never finished enrollment', () => {
    const plan = buildMigrationUpdate({ role: 'babysitter', ejemEmail: 'b@ejm.org' })!;
    const profile = plan.set['profiles.babysitter'] as Record<string, unknown>;
    expect(profile.enrollmentComplete).toBe(false);
  });

  it('omits undefined legacy fields from the synthesized profile', () => {
    const plan = buildMigrationUpdate({ role: 'babysitter', ejemEmail: 'b@ejm.org' })!;
    const profile = plan.set['profiles.babysitter'] as Record<string, unknown>;
    // hourlyRate was never set → must not appear (Firestore rejects undefined)
    expect('hourlyRate' in profile).toBe(false);
    expect('searchable' in profile).toBe(false);
  });

  it('lifts a legacy parent into profiles.parent (enrollmentComplete defaults true)', () => {
    const plan = buildMigrationUpdate({ role: 'parent', familyId: 'famX' })!;
    expect(plan.set['profiles.parent']).toEqual({
      enrollmentComplete: true,
      familyId: 'famX',
    });
    expect(plan.deleteFields).toEqual(expect.arrayContaining(['role', 'familyId', 'enrollmentComplete']));
  });

  it('preserves an explicit parent enrollmentComplete:false', () => {
    const plan = buildMigrationUpdate({ role: 'parent', familyId: 'famX', enrollmentComplete: false })!;
    expect((plan.set['profiles.parent'] as Record<string, unknown>).enrollmentComplete).toBe(false);
  });

  it('falls back to an empty familyId when a parent has none', () => {
    const plan = buildMigrationUpdate({ role: 'parent' })!;
    expect((plan.set['profiles.parent'] as Record<string, unknown>).familyId).toBe('');
  });

  it('lifts a legacy tutor into profiles.tutor with tutor-specific fields', () => {
    const plan = buildMigrationUpdate({
      role: 'tutor',
      ejemEmail: 't@ejm.org',
      subjects: [{ subject: 'math' }],
      sessionLengthsMin: [60],
    })!;
    const profile = plan.set['profiles.tutor'] as Record<string, unknown>;
    expect(profile.ejemEmail).toBe('t@ejm.org');
    expect(profile.subjects).toEqual([{ subject: 'math' }]);
    expect(profile.sessionLengthsMin).toEqual([60]);
    expect(plan.deleteFields).toContain('subjects');
  });

  it('promotes a legacy admin to isAdmin:true and deletes role (no profile slot)', () => {
    const plan = buildMigrationUpdate({ role: 'admin' })!;
    expect(plan.set.isAdmin).toBe(true);
    expect(plan.set['profiles.babysitter']).toBeUndefined();
    expect(plan.deleteFields).toEqual(['role']);
  });
});

describe('buildProfile', () => {
  it('always includes enrollmentComplete and skips undefined keys', () => {
    const profile = buildProfile({ classLevel: 'L2' } as LegacyUserDoc, ['classLevel', 'hourlyRate']);
    expect(profile).toEqual({ enrollmentComplete: false, classLevel: 'L2' });
  });
});
