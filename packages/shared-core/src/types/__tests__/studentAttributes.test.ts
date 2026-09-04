import { describe, it, expect } from 'vitest';
import { getClassLevel, getGender } from '../userAdapter.js';
import type { User } from '../user.js';

// Loose doc builder — the helpers must tolerate real Firestore docs, which
// are looser than the User type (nested profiles carry app-specific fields).
function docOf(shape: Record<string, unknown>): User {
  return shape as unknown as User;
}

describe('getClassLevel (root ?? babysitter ?? tutor)', () => {
  it('prefers the root field', () => {
    const user = docOf({
      classLevel: 'Terminale',
      profiles: { babysitter: { classLevel: '2nde' }, tutor: { classLevel: '3ème' } },
    });
    expect(getClassLevel(user)).toBe('Terminale');
  });

  it('falls back to the babysitter copy, then the tutor copy', () => {
    expect(getClassLevel(docOf({
      profiles: { babysitter: { classLevel: '2nde' }, tutor: { classLevel: '3ème' } },
    }))).toBe('2nde');
    expect(getClassLevel(docOf({
      profiles: { tutor: { classLevel: '3ème' } },
    }))).toBe('3ème');
  });

  it("treats '' as absent at every level", () => {
    expect(getClassLevel(docOf({
      classLevel: '',
      profiles: { babysitter: { classLevel: '' }, tutor: { classLevel: '3ème' } },
    }))).toBe('3ème');
  });

  it('returns undefined when no level has a value', () => {
    expect(getClassLevel(docOf({ profiles: { babysitter: {} } }))).toBeUndefined();
    expect(getClassLevel(docOf({ profiles: {} }))).toBeUndefined();
    expect(getClassLevel(null)).toBeUndefined();
    expect(getClassLevel(undefined)).toBeUndefined();
  });

  it('ignores non-string junk in a nested copy', () => {
    expect(getClassLevel(docOf({
      profiles: { babysitter: { classLevel: 42 }, tutor: { classLevel: '3ème' } },
    }))).toBe('3ème');
  });
});

describe('getGender (root ?? babysitter ?? tutor)', () => {
  it('prefers the root field', () => {
    const user = docOf({
      gender: 'female',
      profiles: { babysitter: { gender: 'male' }, tutor: { gender: 'other' } },
    });
    expect(getGender(user)).toBe('female');
  });

  it('falls back to the babysitter copy, then the tutor copy', () => {
    expect(getGender(docOf({
      profiles: { babysitter: { gender: 'male' }, tutor: { gender: 'other' } },
    }))).toBe('male');
    expect(getGender(docOf({
      profiles: { tutor: { gender: 'other' } },
    }))).toBe('other');
  });

  it('a root/nested explicit null (answered "no answer") resolves to undefined, same as never asked', () => {
    // getGender collapses "never asked" and "answered with nothing selected"
    // into the same undefined result — callers needing that distinction
    // (e.g. the crossApp gap-filling UI) read the raw field instead.
    expect(getGender(docOf({ gender: null, profiles: { babysitter: { gender: null } } }))).toBeUndefined();
  });

  it('returns undefined when no level has a value', () => {
    expect(getGender(docOf({ profiles: { babysitter: {} } }))).toBeUndefined();
    expect(getGender(docOf({ profiles: {} }))).toBeUndefined();
    expect(getGender(null)).toBeUndefined();
    expect(getGender(undefined)).toBeUndefined();
  });

  it('ignores non-string junk in a nested copy', () => {
    expect(getGender(docOf({
      profiles: { babysitter: { gender: 42 }, tutor: { gender: 'prefer_not_to_say' } },
    }))).toBe('prefer_not_to_say');
  });
});
