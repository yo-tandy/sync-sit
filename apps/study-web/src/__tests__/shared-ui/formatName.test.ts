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

  it('capitalizes across BOTH separators of a compound given name', () => {
    // The hyphen case is the one that regressed: study's cards used to render
    // firstName verbatim, so routing them through a space-only capitalize
    // would have turned Jean-Claude into "Jean-claude". Hyphenated given
    // names are common in French, which is the convention this whole change
    // is meant to apply.
    expect(formatProviderName('jean claude', 'dubois')).toBe('Jean Claude DUBOIS');
    expect(formatProviderName('jean-claude', 'dubois')).toBe('Jean-Claude DUBOIS');
    expect(formatProviderName('Jean-Claude', 'Dubois')).toBe('Jean-Claude DUBOIS');
    expect(formatProviderName('marie-thérèse', 'roy')).toBe('Marie-Thérèse ROY');
    expect(formatProviderName('anne-marie claire', 'roy')).toBe('Anne-Marie Claire ROY');
  });

  it('capitalizes after an apostrophe too — this only ever sees GIVEN names', () => {
    // Safe here because surnames never reach capitalize: formatProviderName
    // upper-cases them wholesale, so the French particle problem
    // ("Jeanne d'Arc") is structurally out of reach on this path.
    expect(capitalize("n'golo")).toBe("N'Golo");
    expect(formatProviderName("n'golo", 'kante')).toBe("N'Golo KANTE");
  });

  it('preserves the original spacing and hyphenation verbatim', () => {
    // The capturing split keeps separators, so a double space or a spaced
    // hyphen survives rather than being normalized into something the user
    // did not type.
    expect(capitalize('jean  claude')).toBe('Jean  Claude');
    expect(capitalize('jean - claude')).toBe('Jean - Claude');
  });

  it('capitalize leaves an empty or missing string alone', () => {
    expect(capitalize(undefined)).toBe('');
    expect(capitalize('')).toBe('');
    expect(capitalize('yoav yaari')).toBe('Yoav Yaari');
  });
});
