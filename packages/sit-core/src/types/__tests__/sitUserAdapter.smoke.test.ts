import { describe, it, expect } from 'vitest';
import { getBabysitterProfile, getBabysitterView, getSitRole } from '../sitUserAdapter.js';
import {
  getParentProfile,
  getParentView,
  getUserRole,
  isParent,
  isBabysitter,
  isTutor,
  isAdmin,
} from '@ejm/shared-core';

// Plan D doc: identity at top level, role data under profiles.{role}.
const babysitter = {
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

const parent = {
  uid: 'p1', email: 'p@b.com', firstName: 'Cy', lastName: 'P',
  status: 'active', language: 'en', notifPrefs: {}, fcmTokens: [],
  createdAt: {}, updatedAt: {},
  profiles: { parent: { enrollmentComplete: true, familyId: 'fam1', phone: '+33100' } },
} as any;

const tutor = {
  uid: 't1', email: 't@b.com', firstName: 'Tom', lastName: 'T',
  status: 'active', language: 'en', notifPrefs: {}, fcmTokens: [],
  createdAt: {}, updatedAt: {},
  profiles: { tutor: { enrollmentComplete: true, ejemEmail: 'tom@ejm.org' } },
} as any;

const admin = { uid: 'ad1', email: 'ad@b.com', isAdmin: true, profiles: {} } as any;

describe('sit user-doc adapters', () => {
  it('reads the babysitter profile + view', () => {
    expect(getBabysitterProfile(babysitter)?.hourlyRate).toBe(15);
    expect(getSitRole(babysitter)).toBe('babysitter');
    expect(getBabysitterView(babysitter)?.firstName).toBe('Ada');
    expect(getBabysitterView(babysitter)?.kidAgeRange.max).toBe(10);
  });

  it('reads the parent profile + view', () => {
    expect(getParentProfile(parent)?.familyId).toBe('fam1');
    expect(getParentView(parent)?.phone).toBe('+33100');
    expect(getParentView(parent)?.email).toBe('p@b.com');
    expect(getSitRole(parent)).toBe('parent');
  });

  it('returns undefined/null for the wrong role', () => {
    expect(getBabysitterProfile(parent)).toBeUndefined();
    expect(getParentProfile(babysitter)).toBeUndefined();
    expect(getBabysitterView(parent)).toBeNull();
    expect(getBabysitterView(null)).toBeNull();
  });
});

describe('cross-app role predicates', () => {
  it('getUserRole resolves the profile role', () => {
    expect(getUserRole(babysitter)).toBe('babysitter');
    expect(getUserRole(tutor)).toBe('tutor');
    expect(getUserRole(parent)).toBe('parent');
    expect(getUserRole(admin)).toBe('admin');
    expect(getUserRole(null)).toBeUndefined();
  });

  it('predicates match the right role', () => {
    expect(isParent(parent)).toBe(true);
    expect(isParent(babysitter)).toBe(false);
    expect(isBabysitter(babysitter)).toBe(true);
    expect(isBabysitter(parent)).toBe(false);
    expect(isTutor(tutor)).toBe(true);
    expect(isTutor(babysitter)).toBe(false);
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(parent)).toBe(false);
  });
});
