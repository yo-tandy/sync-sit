import { describe, it, expect } from 'vitest';
import { getTutorProfile, getTutorView, getStudyRole } from '../studyUserAdapter.js';
import { getParentProfile } from '@ejm/shared-core';

// New-shape tutor (Plan D): profiles.tutor, no top-level role.
const newTutor = {
  uid: 't1', email: 't@b.com', firstName: 'Tan', lastName: 'Yu',
  status: 'active', language: 'en', notifPrefs: {}, fcmTokens: [],
  createdAt: {}, updatedAt: {},
  profiles: {
    tutor: {
      enrollmentComplete: true, ejemEmail: 'tan@ejm.org', classLevel: 'Terminale',
      languages: ['en'], areaMode: 'arrondissement',
      subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      sessionLengthsMin: [60], locationPrefs: ['online'], paddingMin: 15, searchable: true,
    },
  },
} as never;

// Legacy tutor: top-level role + flat fields, no profiles.
const legacyTutor = {
  uid: 't2', email: 'c@d.com', firstName: 'Bea', lastName: 'Le',
  status: 'active', language: 'en', notifPrefs: {}, fcmTokens: [],
  createdAt: {}, updatedAt: {},
  role: 'tutor', enrollmentComplete: true, ejemEmail: 'bea@ejm.org', classLevel: '1ère',
  languages: ['fr'], areaMode: 'arrondissement',
  subjects: [], sessionLengthsMin: [45, 60], locationPrefs: ['tutor_home'], paddingMin: 10, searchable: false,
} as never;

const newParent = {
  uid: 'p1', email: 'p@b.com', firstName: 'Cy', lastName: 'P',
  status: 'active', language: 'en', notifPrefs: {}, fcmTokens: [],
  createdAt: {}, updatedAt: {},
  profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
} as never;

describe('study dual-read adapters', () => {
  it('reads tutor profile from the new shape', () => {
    expect(getTutorProfile(newTutor)?.sessionLengthsMin).toEqual([60]);
    expect(getTutorProfile(newTutor)?.subjects[0].rate).toBe(20);
    expect(getStudyRole(newTutor)).toBe('tutor');
    expect(getTutorView(newTutor)?.firstName).toBe('Tan');
    expect(getTutorView(newTutor)?.paddingMin).toBe(15);
  });

  it('synthesizes tutor profile from the legacy shape', () => {
    expect(getTutorProfile(legacyTutor)?.sessionLengthsMin).toEqual([45, 60]);
    expect(getTutorProfile(legacyTutor)?.locationPrefs).toEqual(['tutor_home']);
    expect(getStudyRole(legacyTutor)).toBe('tutor');
    expect(getTutorView(legacyTutor)?.ejemEmail).toBe('bea@ejm.org');
    expect(getTutorView(legacyTutor)?.firstName).toBe('Bea');
  });

  it('resolves study role for parents (both shapes) and undefined for none', () => {
    expect(getStudyRole(newParent)).toBe('parent');
    expect(getParentProfile(newParent)?.familyId).toBe('fam1');
    expect(getStudyRole(null)).toBeUndefined();
    expect(getStudyRole({ uid: 'x', profiles: {} } as never)).toBeUndefined();
  });

  it('returns undefined / null for the wrong role', () => {
    expect(getTutorProfile(newParent)).toBeUndefined();
    expect(getTutorView(newParent)).toBeNull();
    expect(getTutorView(null)).toBeNull();
  });
});
