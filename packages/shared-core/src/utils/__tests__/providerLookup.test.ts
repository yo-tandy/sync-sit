import { describe, it, expect } from 'vitest';
import { matchesProviderIdentity, normalizePhoneForMatch } from '../providerLookup.js';

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
