import { describe, it, expect } from 'vitest';
import {
  ENDORSEMENT_APPS,
  ENDORSEMENT_SUBJECT_FIELD,
  PUBLIC_ENDORSEMENT_STATUSES,
  endorsementSources,
  toCrossAppEndorsement,
} from '../crossAppEndorsements.js';

describe('endorsementSources', () => {
  it('puts the current app first and the siblings after, in registry order', () => {
    expect(endorsementSources('sit').map((s) => s.app)).toEqual(['sit', 'study', 'do']);
    expect(endorsementSources('study').map((s) => s.app)).toEqual(['study', 'sit', 'do']);
    expect(endorsementSources('do').map((s) => s.app)).toEqual(['do', 'sit', 'study']);
  });

  it('covers every registered app exactly once, whichever app asks', () => {
    for (const app of ENDORSEMENT_APPS) {
      const apps = endorsementSources(app).map((s) => s.app);
      expect(new Set(apps).size).toBe(ENDORSEMENT_APPS.length);
      expect(apps.length).toBe(ENDORSEMENT_APPS.length);
    }
  });

  it('pairs each app with its `references` subject field', () => {
    expect(endorsementSources('sit')).toEqual([
      { app: 'sit', field: 'babysitterUserId' },
      { app: 'study', field: 'tutorUserId' },
      { app: 'do', field: 'doerUserId' },
    ]);
  });

  it('keeps the subject fields distinct — two apps sharing one field would double-count', () => {
    const fields = Object.values(ENDORSEMENT_SUBJECT_FIELD);
    expect(new Set(fields).size).toBe(fields.length);
  });
});

describe('PUBLIC_ENDORSEMENT_STATUSES', () => {
  // Pinned against the H2-hardened `references` read rule: the public-status
  // disjunct is `status in ['approved','published']`, and Firestore proves it
  // only from the query. Widening this array without widening the rule turns
  // every cross-app card into PERMISSION_DENIED.
  it('is exactly the rule\'s public-status disjunct', () => {
    expect(PUBLIC_ENDORSEMENT_STATUSES).toEqual(['approved', 'published']);
  });
});

describe('toCrossAppEndorsement', () => {
  it('maps a study endorsement (referenceText + submittedByName)', () => {
    expect(
      toCrossAppEndorsement('study', 'e1', {
        tutorUserId: 't1',
        appSource: 'study',
        referenceText: 'Great maths tutor',
        submittedByName: 'Dana',
        refName: 'ignored when submittedByName is present',
      }),
    ).toEqual({
      id: 'e1',
      sourceApp: 'study',
      refName: 'Dana',
      text: 'Great maths tutor',
      refEmail: undefined,
      refPhone: undefined,
      refWhatsapp: undefined,
      isEjmFamily: false,
      numberOfKids: undefined,
      kidAges: undefined,
    });
  });

  it('maps a sit manual reference (note + refName + contact details)', () => {
    const line = toCrossAppEndorsement('sit', 'r1', {
      babysitterUserId: 'b1',
      type: 'manual',
      refName: 'Mme Martin',
      note: 'Sat for us for two years',
      refEmail: 'm@example.com',
      refPhone: '+33100000000',
      refWhatsapp: '+33100000000',
      isEjmFamily: true,
      numberOfKids: 2,
      kidAges: [4, 7],
    });
    expect(line.refName).toBe('Mme Martin');
    expect(line.text).toBe('Sat for us for two years');
    expect(line.refEmail).toBe('m@example.com');
    expect(line.isEjmFamily).toBe(true);
    expect(line.numberOfKids).toBe(2);
    expect(line.kidAges).toEqual([4, 7]);
  });

  it('degrades to empty strings rather than throwing on a foreign/sparse doc', () => {
    const line = toCrossAppEndorsement('do', 'd1', {});
    expect(line).toMatchObject({ id: 'd1', sourceApp: 'do', refName: '', text: '', isEjmFamily: false });
  });

  it('does not treat empty strings or wrong types as values', () => {
    const line = toCrossAppEndorsement('sit', 'r2', {
      submittedByName: '',
      refName: 'Fallback',
      referenceText: '',
      note: 'Fallback text',
      isEjmFamily: 'yes',
      numberOfKids: '3',
      kidAges: 'four',
    });
    expect(line.refName).toBe('Fallback');
    expect(line.text).toBe('Fallback text');
    expect(line.isEjmFamily).toBe(false);
    expect(line.numberOfKids).toBeUndefined();
    expect(line.kidAges).toBeUndefined();
  });
});
