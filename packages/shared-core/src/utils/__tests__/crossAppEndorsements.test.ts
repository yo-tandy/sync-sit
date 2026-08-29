import { describe, it, expect } from 'vitest';
import {
  ENDORSEMENT_APPS,
  ENDORSEMENT_PER_SOURCE_LIMIT,
  endorsementLabelKey,
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

describe('endorsementLabelKey', () => {
  it('derives the key from the app name under each surface\'s own prefix', () => {
    expect(endorsementLabelKey('references.from', 'study')).toBe('references.fromStudy');
    expect(endorsementLabelKey('references.from', 'do')).toBe('references.fromDo');
    expect(endorsementLabelKey('family.search.card.endorsementFrom', 'sit')).toBe(
      'family.search.card.endorsementFromSit',
    );
    expect(endorsementLabelKey('family.taskDetail.endorsementFrom', 'study')).toBe(
      'family.taskDetail.endorsementFromStudy',
    );
  });

  it('produces a distinct key for every registered app', () => {
    const keys = ENDORSEMENT_APPS.map((a) => endorsementLabelKey('x.', a));
    expect(new Set(keys).size).toBe(ENDORSEMENT_APPS.length);
  });
});

describe('ENDORSEMENT_PER_SOURCE_LIMIT', () => {
  it('is a per-source cap, so one app cannot crowd out another', () => {
    // Pinned because it is asserted verbatim in the surfaces' query-shape
    // tests; a change here must be a deliberate, cross-surface decision.
    expect(ENDORSEMENT_PER_SOURCE_LIMIT).toBe(10);
  });
});

describe('runtime immutability', () => {
  // The module argues these values must not drift; `readonly` is erased at
  // runtime, so only Object.freeze actually enforces it. Refactoring the
  // freeze back to a bare `as const` would pass every content assertion above
  // while leaving the array pushable — one stray push turns all four
  // cross-app surfaces into PERMISSION_DENIED at once.
  it.each([
    ['PUBLIC_ENDORSEMENT_STATUSES', PUBLIC_ENDORSEMENT_STATUSES],
    ['ENDORSEMENT_APPS', ENDORSEMENT_APPS],
    ['ENDORSEMENT_SUBJECT_FIELD', ENDORSEMENT_SUBJECT_FIELD],
  ])('%s is frozen at runtime, not merely readonly at compile time', (_name, value) => {
    expect(Object.isFrozen(value)).toBe(true);
  });

  it('rejects a push onto the status list rather than silently accepting it', () => {
    // Module scope is strict mode, so the write throws instead of no-op'ing.
    expect(() =>
      (PUBLIC_ENDORSEMENT_STATUSES as unknown as string[]).push('private'),
    ).toThrow();
    expect(PUBLIC_ENDORSEMENT_STATUSES).toEqual(['approved', 'published']);
  });

  it('rejects re-pointing a subject field', () => {
    expect(() => {
      (ENDORSEMENT_SUBJECT_FIELD as unknown as Record<string, string>).sit = 'tutorUserId';
    }).toThrow();
    expect(ENDORSEMENT_SUBJECT_FIELD.sit).toBe('babysitterUserId');
  });
});

describe('registry is the single source for GDPR erasure keys', () => {
  it('covers every app, so a new product is erasable by the same one-line entry', () => {
    // shared-functions' REFERENCE_PROVIDER_KEYS derives from this map. Pinned
    // here because the two failure modes are asymmetric: a missed rendering
    // entry costs a badge, a missed erasure key leaves a provider's
    // endorsements alive after their account is deleted — silently.
    const keys = Object.values(ENDORSEMENT_SUBJECT_FIELD);
    expect(keys).toEqual(['babysitterUserId', 'tutorUserId', 'doerUserId']);
    for (const app of ENDORSEMENT_APPS) {
      expect(keys).toContain(ENDORSEMENT_SUBJECT_FIELD[app]);
    }
  });
});
