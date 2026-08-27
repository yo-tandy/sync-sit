import { describe, it, expect } from 'vitest';
import { capitalize, formatProviderName } from '@ejm/shared-ui';

/**
 * The shared person-name form (parity D2, issue #240). Sit printed
 * "Lea BERNARD" and study printed "Camille Moreau"; sit's convention won and
 * moved into shared-ui, so both apps' cards now render through this.
 *
 * Tested from study-web because shared-ui has no runner of its own and is not
 * in `test:unit`'s filter list — the same reason every other shared-ui pin
 * lives in this directory.
 */
describe('formatProviderName', () => {
  it('renders the French form: given name title case, family name in caps', () => {
    expect(formatProviderName('marie', 'dupont')).toBe('Marie DUPONT');
    expect(formatProviderName('Camille', 'Moreau')).toBe('Camille MOREAU');
  });

  it('normalizes shouting input rather than preserving it', () => {
    // A user who typed their given name in caps at enrollment should not be
    // shouted back at; the surname is meant to be caps either way.
    expect(formatProviderName('LEA', 'BERNARD')).toBe('Lea BERNARD');
  });

  it('degrades to the half it has, with no stray separator', () => {
    // Legacy and partially-enrolled docs can carry one half and not the
    // other; a naive `${first} ${last}` leaves a leading or trailing space
    // that shows up as odd padding in a card.
    expect(formatProviderName('Marie', undefined)).toBe('Marie');
    expect(formatProviderName(undefined, 'Dupont')).toBe('DUPONT');
    expect(formatProviderName(undefined, undefined)).toBe('');
    expect(formatProviderName('', '')).toBe('');
  });

  it('capitalizes each word of a compound given name', () => {
    expect(formatProviderName('jean claude', 'dubois')).toBe('Jean Claude DUBOIS');
  });

  it('capitalize leaves an empty or missing string alone', () => {
    expect(capitalize(undefined)).toBe('');
    expect(capitalize('')).toBe('');
    expect(capitalize('yoav yaari')).toBe('Yoav Yaari');
  });
});
