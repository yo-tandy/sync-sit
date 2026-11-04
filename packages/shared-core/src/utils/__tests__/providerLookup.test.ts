import { describe, it, expect } from 'vitest';
import { matchesProviderIdentity, normalizePhoneForMatch, soundex, matchesName } from '../providerLookup.js';

describe('normalizePhoneForMatch', () => {
  it('collapses a leading-0 French number and a +33 number to the same key', () => {
    expect(normalizePhoneForMatch('06 12 34 56 78')).toBe(normalizePhoneForMatch('+33 6 12 34 56 78'));
  });

  it('ignores dashes, parens and spaces', () => {
    expect(normalizePhoneForMatch('(06)-12-34-56-78')).toBe('612345678');
  });

  it('keeps only the last 9 digits', () => {
    expect(normalizePhoneForMatch('0033612345678')).toBe('612345678');
  });
});

describe('matchesProviderIdentity', () => {
  const candidate = {
    fullName: 'Marie Dupont',
    email: 'marie.dupont@example.com',
    ejemEmail: 'marie@ejm.internal',
    contactPhone: '06 12 34 56 78',
    whatsapp: '+33 7 98 76 54 32',
  };

  it('matches a name substring, case-insensitively', () => {
    expect(matchesProviderIdentity('dupont', candidate)).toBe(true);
    expect(matchesProviderIdentity('MARIE', candidate)).toBe(true);
  });

  it('rejects a name that is not a substring', () => {
    expect(matchesProviderIdentity('durand', candidate)).toBe(false);
  });

  it('matches email and ejemEmail exactly, case-insensitively', () => {
    expect(matchesProviderIdentity('Marie.Dupont@example.com', candidate)).toBe(true);
    expect(matchesProviderIdentity('marie@ejm.internal', candidate)).toBe(true);
  });

  it('does not substring-match on email', () => {
    expect(matchesProviderIdentity('marie.dupont', candidate)).toBe(false);
  });

  it('matches contactPhone in a different format via normalization', () => {
    expect(matchesProviderIdentity('+33612345678', candidate)).toBe(true);
  });

  it('matches whatsapp the same way', () => {
    expect(matchesProviderIdentity('0798765432', candidate)).toBe(true);
  });

  it('does not attempt a phone match for a short numeric query', () => {
    // A 4-digit query is well under the phone-shaped threshold; without the
    // digit-count guard this could spuriously collide with a normalized
    // phone number's tail.
    expect(matchesProviderIdentity('5678', candidate)).toBe(false);
  });

  it('is safe against a candidate with no phone/whatsapp on file', () => {
    expect(
      matchesProviderIdentity('0612345678', {
        fullName: 'Jean Martin',
        email: 'jean@example.com',
        ejemEmail: 'jean@ejm.internal',
      }),
    ).toBe(false);
  });
});

// Issue #558: the owner's acceptance list for "John Doe <jdoe28@ejm.org>
// 0523423210" — every one of these queries must find him.
describe('matchesProviderIdentity — smart name matching (#558)', () => {
  const john = {
    fullName: 'John Doe',
    email: 'jdoe28@ejm.org',
    ejemEmail: 'jdoe28@ejm.org',
    contactPhone: '0523423210',
  };

  it.each([
    ['John', 'first name'],
    ['Doe', 'last name'],
    ['Jon', 'soundex: Jon ≈ John'],
    ['John Doe', 'full name'],
    ['Doe John', 'reversed order'],
    ['Jon Do', 'fuzzy first + prefix last'],
    ['jdoe28@ejm.org', 'exact email'],
    ['05 23 42 32 10', 'phone with spaces'],
    ['0523423210', 'phone bare'],
    ['+33 5 23 42 32 10', 'phone with country code'],
  ])('finds him with %s (%s)', (query) => {
    expect(matchesProviderIdentity(query, john)).toBe(true);
  });

  it('does not find him with a different surname, a partial email, or a two-letter phonetic', () => {
    expect(matchesProviderIdentity('John Durand', john)).toBe(false);
    expect(matchesProviderIdentity('jdoe28@ejm', john)).toBe(false);
    // No '@' → treated as a name: no name token starts with "jdoe".
    expect(matchesProviderIdentity('jdoe', john)).toBe(false);
    // Two letters: prefix only, never soundex.
    expect(matchesProviderIdentity('Jn', john)).toBe(false);
  });

  it('is accent-insensitive on names', () => {
    const elodie = { fullName: 'Élodie Lefèvre', email: 'e@x.org', ejemEmail: 'e@ejm.org' };
    expect(matchesProviderIdentity('elodie lefevre', elodie)).toBe(true);
    expect(matchesProviderIdentity('Lefèvre', elodie)).toBe(true);
  });

  it('a phone-shaped query is only ever phone-matched', () => {
    // 8+ digits never falls through to the name path.
    expect(matchesProviderIdentity('12345678', { fullName: '12345678 Smith', email: 'a@b.c', ejemEmail: 'a@ejm.c' })).toBe(false);
  });
});

describe('soundex', () => {
  it('codes the classic examples', () => {
    expect(soundex('Robert')).toBe('R163');
    expect(soundex('Rupert')).toBe('R163');
    expect(soundex('Tymczak')).toBe('T522');
    expect(soundex('Pfister')).toBe('P236');
    expect(soundex('john')).toBe(soundex('jon'));
  });
  it('returns an empty code for a token with no letters', () => {
    expect(soundex('123')).toBe('');
  });
});

describe('matchesName', () => {
  it('requires EVERY query token to land on some name token', () => {
    expect(matchesName('John Smith', 'John Doe')).toBe(false);
    expect(matchesName('Doe', 'John Doe')).toBe(true);
  });
  it('splits hyphenated and apostrophe names into tokens', () => {
    expect(matchesName('Pierre', 'Jean-Pierre Dupont')).toBe(true);
    expect(matchesName("Hara", "Scarlett O'Hara")).toBe(true);
  });
});
