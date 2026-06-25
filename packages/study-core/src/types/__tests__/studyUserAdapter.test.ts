import { describe, it, expect } from 'vitest';
import { getTutorProfile, getTutorView, getStudyRole } from '../studyUserAdapter.js';
import { getParentProfile } from '@ejm/shared-core';

// Plan D tutor: profiles.tutor.
const tutor = {
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

const parent = {
  uid: 'p1', email: 'p@b.com', firstName: 'Cy', lastName: 'P',
  status: 'active', language: 'en', notifPrefs: {}, fcmTokens: [],
  createdAt: {}, updatedAt: {},
  profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
} as never;

describe('study user-doc adapters', () => {
  it('reads the tutor profile + view', () => {
    expect(getTutorProfile(tutor)?.sessionLengthsMin).toEqual([60]);
    expect(getTutorProfile(tutor)?.subjects[0].rate).toBe(20);
    expect(getStudyRole(tutor)).toBe('tutor');
    expect(getTutorView(tutor)?.firstName).toBe('Tan');
    expect(getTutorView(tutor)?.paddingMin).toBe(15);
  });

  it('resolves study role for parents and undefined for none', () => {
    expect(getStudyRole(parent)).toBe('parent');
    expect(getParentProfile(parent)?.familyId).toBe('fam1');
    expect(getStudyRole(null)).toBeUndefined();
    expect(getStudyRole({ uid: 'x', profiles: {} } as never)).toBeUndefined();
  });

  it('returns undefined / null for the wrong role', () => {
    expect(getTutorProfile(parent)).toBeUndefined();
    expect(getTutorView(parent)).toBeNull();
    expect(getTutorView(null)).toBeNull();
  });
});
