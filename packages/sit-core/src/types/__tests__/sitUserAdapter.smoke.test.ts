import { describe, it, expect } from 'vitest';
import { getBabysitterProfile, getBabysitterView, getSitRole } from '../sitUserAdapter.js';
import { getParentProfile, getParentView } from '@ejm/shared-core';

// New-shape doc (Plan D): profiles map, no top-level role.
const newBabysitter = {
  uid: 'u1', email: 'a@b.com', firstName: 'Ada', lastName: 'L',
  status: 'active', language: 'en', notifPrefs: {}, fcmTokens: [],
  createdAt: {}, updatedAt: {},
  profiles: {
    babysitter: {
      enrollmentComplete: true, ejemEmail: 'ada@ejm.org', classLevel: 'Terminale',
      languages: ['en'], areaMode: 'arrondissement',
      kidAgeRange: { min: 2, max: 10 }, maxKids: 3, hourlyRate: 15, searchable: true,
    },
  },
} as any;

// Legacy doc (pre-Plan-D): top-level role + flat fields, no profiles.
const legacyBabysitter = {
  uid: 'u2', email: 'c@d.com', firstName: 'Bea', lastName: 'M',
  status: 'active', language: 'en', notifPrefs: {}, fcmTokens: [],
  createdAt: {}, updatedAt: {},
  role: 'babysitter', enrollmentComplete: true, ejemEmail: 'bea@ejm.org',
  classLevel: '1ère', languages: ['fr'], areaMode: 'arrondissement',
  kidAgeRange: { min: 0, max: 5 }, maxKids: 2, hourlyRate: 12, searchable: false,
} as any;

const newParent = {
  uid: 'p1', email: 'p@b.com', firstName: 'Cy', lastName: 'P',
  status: 'active', language: 'en', notifPrefs: {}, fcmTokens: [],
  createdAt: {}, updatedAt: {},
  profiles: { parent: { enrollmentComplete: true, familyId: 'fam1', phone: '+33100' } },
} as any;

const legacyParent = {
  uid: 'p2', email: 'q@b.com', firstName: 'Di', lastName: 'Q',
  status: 'active', language: 'en', notifPrefs: {}, fcmTokens: [],
  createdAt: {}, updatedAt: {},
  role: 'parent', familyId: 'fam2', phone: '+33200',
} as any;

describe('sit dual-read adapters', () => {
  it('reads babysitter profile from new shape', () => {
    expect(getBabysitterProfile(newBabysitter)?.hourlyRate).toBe(15);
    expect(getSitRole(newBabysitter)).toBe('babysitter');
    expect(getBabysitterView(newBabysitter)?.firstName).toBe('Ada');
    expect(getBabysitterView(newBabysitter)?.kidAgeRange.max).toBe(10);
  });

  it('synthesizes babysitter profile from legacy shape', () => {
    expect(getBabysitterProfile(legacyBabysitter)?.hourlyRate).toBe(12);
    expect(getSitRole(legacyBabysitter)).toBe('babysitter');
    expect(getBabysitterView(legacyBabysitter)?.firstName).toBe('Bea');
    expect(getBabysitterView(legacyBabysitter)?.ejemEmail).toBe('bea@ejm.org');
  });

  it('reads parent from both shapes', () => {
    expect(getParentProfile(newParent)?.familyId).toBe('fam1');
    expect(getParentView(newParent)?.phone).toBe('+33100');
    expect(getSitRole(newParent)).toBe('parent');
    expect(getParentProfile(legacyParent)?.familyId).toBe('fam2');
    expect(getParentView(legacyParent)?.email).toBe('q@b.com');
    expect(getSitRole(legacyParent)).toBe('parent');
  });

  it('returns undefined for the wrong role', () => {
    expect(getBabysitterProfile(newParent)).toBeUndefined();
    expect(getParentProfile(newBabysitter)).toBeUndefined();
    expect(getBabysitterView(null)).toBeNull();
  });
});
