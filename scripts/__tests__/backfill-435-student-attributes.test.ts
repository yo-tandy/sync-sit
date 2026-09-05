import { describe, expect, it } from 'vitest';
// The script guards its main() behind require.main, so importing it here only
// loads the pure helpers (no firebase-admin resolution).
import { computeRootPatch, nestedValue, STUDENT_FIELDS } from '../backfill-435-student-attributes.cjs';

describe('nestedValue', () => {
  it('resolves non-empty STRINGS only — mirroring getClassLevel/getGender\'s nonEmpty', () => {
    expect(nestedValue('Terminale')).toBe('Terminale');
    expect(nestedValue('')).toBeUndefined();
    expect(nestedValue(null)).toBeUndefined();
    expect(nestedValue(undefined)).toBeUndefined();
    expect(nestedValue(42)).toBeUndefined();
    expect(nestedValue({ nope: true })).toBeUndefined();
  });
});

describe('computeRootPatch', () => {
  it('copies nested babysitter values to an empty root', () => {
    expect(computeRootPatch({
      profiles: { babysitter: { classLevel: 'Terminale', gender: 'female' } },
    })).toEqual({ patch: { classLevel: 'Terminale', gender: 'female' }, conflicts: [] });
  });

  it('copies from the tutor profile when the babysitter copy is absent', () => {
    expect(computeRootPatch({
      profiles: { tutor: { classLevel: '2nde', gender: 'other' } },
    })).toEqual({ patch: { classLevel: '2nde', gender: 'other' }, conflicts: [] });
  });

  it('babysitter copy WINS over a disagreeing tutor copy, and is APPLIED (not skipped)', () => {
    // Deliberate divergence from backfill-shared-identity.cjs: a conflict
    // here is a logged warning, never a reason to withhold the write.
    expect(computeRootPatch({
      profiles: {
        babysitter: { classLevel: 'Terminale', gender: 'female' },
        tutor: { classLevel: '2nde', gender: 'male' },
      },
    })).toEqual({
      patch: { classLevel: 'Terminale', gender: 'female' },
      conflicts: [
        { field: 'classLevel', babysitter: 'Terminale', tutor: '2nde' },
        { field: 'gender', babysitter: 'female', tutor: 'male' },
      ],
    });
  });

  it('resolves per FIELD: babysitter classLevel + tutor gender combine', () => {
    expect(computeRootPatch({
      profiles: {
        babysitter: { classLevel: 'Terminale' },
        tutor: { gender: 'other' },
      },
    })).toEqual({ patch: { classLevel: 'Terminale', gender: 'other' }, conflicts: [] });
  });

  it('NEVER touches a populated root field (idempotent)', () => {
    const doc = {
      classLevel: 'Terminale',
      gender: 'female',
      profiles: {
        babysitter: { classLevel: '2nde', gender: 'male' },
      },
    };
    expect(computeRootPatch(doc)).toBeNull();
  });

  it('lifts only the field whose root key is ABSENT, alongside an already-set one', () => {
    expect(computeRootPatch({
      classLevel: 'Terminale', // already canonical — untouched
      profiles: { babysitter: { classLevel: '2nde', gender: 'female' } },
    })).toEqual({ patch: { gender: 'female' }, conflicts: [] });
  });

  it("skips nested null and '' — they are absence, not values (matches getGender's null-as-absent semantics)", () => {
    // sit's StepProfile.tsx writes `gender: gender || null` when the
    // question ran but nothing was selected — that is NOT a value to lift.
    expect(computeRootPatch({
      profiles: {
        babysitter: { classLevel: 'Terminale', gender: null },
        tutor: { gender: 'other' },
      },
    })).toEqual({ patch: { classLevel: 'Terminale', gender: 'other' }, conflicts: [] });
  });

  it('MIXED junk: a junk babysitter value does not shadow a valid tutor value', () => {
    expect(computeRootPatch({
      profiles: {
        babysitter: { classLevel: 42 },
        tutor: { classLevel: '3ème' },
      },
    })).toEqual({ patch: { classLevel: '3ème' }, conflicts: [] });
  });

  it('ignores non-string junk in nested copies', () => {
    expect(computeRootPatch({
      profiles: { babysitter: { classLevel: 42, gender: {} } },
    })).toBeNull();
  });

  it('returns null for docs with nothing to lift (parents, empty profiles)', () => {
    expect(computeRootPatch({ profiles: { parent: { familyId: 'f1' } } })).toBeNull();
    expect(computeRootPatch({ profiles: {} })).toBeNull();
    expect(computeRootPatch({})).toBeNull();
  });

  it('covers exactly the two student-attribute fields', () => {
    expect(STUDENT_FIELDS).toEqual(['classLevel', 'gender']);
  });
});
