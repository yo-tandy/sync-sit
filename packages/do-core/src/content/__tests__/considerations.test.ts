import { describe, it, expect } from 'vitest';
import {
  CONSIDERATIONS,
  CONSIDERATIONS_EN,
  CONSIDERATIONS_FR,
  getConsideration,
  type ConsiderationsLocale,
} from '../index.js';

describe('getConsideration', () => {
  it('resolves a known key in both locales', () => {
    expect(getConsideration('considerations.ikea.drilling', 'en')).toBe(
      CONSIDERATIONS_EN['considerations.ikea.drilling'],
    );
    expect(getConsideration('considerations.ikea.drilling', 'fr')).toBe(
      CONSIDERATIONS_FR['considerations.ikea.drilling'],
    );
  });

  it('returns undefined for an unknown key (callers render nothing)', () => {
    expect(getConsideration('considerations.ikea.not_a_key', 'en')).toBeUndefined();
    expect(getConsideration('', 'fr')).toBeUndefined();
  });

  it('degrades to undefined on an out-of-union locale instead of throwing', () => {
    // i18n detectors hand out region subtags ('fr-FR' via
    // localStorage/navigator) — a renderer passing i18n.language through
    // must get graceful degradation, not a TypeError in the component tree.
    expect(
      getConsideration(
        'considerations.ikea.drilling',
        'fr-FR' as ConsiderationsLocale,
      ),
    ).toBeUndefined();
  });

  it('does not resolve inherited object-prototype keys as content', () => {
    expect(getConsideration('constructor', 'en')).toBeUndefined();
    expect(getConsideration('toString', 'fr')).toBeUndefined();
    expect(getConsideration('__proto__', 'en')).toBeUndefined();
  });

  it('CONSIDERATIONS exposes exactly the two locale tables', () => {
    expect(Object.keys(CONSIDERATIONS).sort()).toEqual(['en', 'fr']);
    expect(CONSIDERATIONS.en).toBe(CONSIDERATIONS_EN);
    expect(CONSIDERATIONS.fr).toBe(CONSIDERATIONS_FR);
  });
});
