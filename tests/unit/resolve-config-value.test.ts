import { describe, it, expect } from 'vitest';
import { resolveConfigValue } from '@ejm/shared-functions/config/adminConfig.js';
import { ADMIN_CONFIG_DEFS } from '@ejm/shared-core';

/**
 * Round-7 review: the pure server-side half of the fallback contract.
 * resolveConfigValue is what makes "neither the panel nor a rogue console
 * edit can brick a callable" true for all 14 keys and both entry points
 * (getConfigValue and the cleanup cron's injected-db path); its client
 * twin has this matrix in both apps, the server half was only covered
 * indirectly through two emulator effect pins on a single key.
 */
describe('resolveConfigValue (pure fallback matrix)', () => {
  const key = 'publishedSearchMaxActive' as const;
  const def = ADMIN_CONFIG_DEFS[key];

  it('returns a stored in-bounds integer as-is', () => {
    expect(resolveConfigValue(def.min, key)).toBe(def.min);
    expect(resolveConfigValue(def.max, key)).toBe(def.max);
  });

  it('absent / undefined falls back to the default', () => {
    expect(resolveConfigValue(undefined, key)).toBe(def.default);
  });

  it('non-number shapes fall back (string, null, object, boolean)', () => {
    expect(resolveConfigValue('5', key)).toBe(def.default);
    expect(resolveConfigValue(null, key)).toBe(def.default);
    expect(resolveConfigValue({ value: 5 }, key)).toBe(def.default);
    expect(resolveConfigValue(true, key)).toBe(def.default);
  });

  it('non-integer numbers fall back (float, NaN, Infinity)', () => {
    expect(resolveConfigValue(2.5, key)).toBe(def.default);
    expect(resolveConfigValue(NaN, key)).toBe(def.default);
    expect(resolveConfigValue(Infinity, key)).toBe(def.default);
    expect(resolveConfigValue(-Infinity, key)).toBe(def.default);
  });

  it('out-of-bounds integers fall back (below min, above max)', () => {
    expect(resolveConfigValue(def.min - 1, key)).toBe(def.default);
    expect(resolveConfigValue(def.max + 1, key)).toBe(def.default);
  });

  it('holds for every key in the table (default is always in bounds)', () => {
    for (const k of Object.keys(ADMIN_CONFIG_DEFS) as (keyof typeof ADMIN_CONFIG_DEFS)[]) {
      const d = ADMIN_CONFIG_DEFS[k];
      expect(resolveConfigValue(999_999_999, k)).toBe(d.default);
      expect(resolveConfigValue(d.default, k)).toBe(d.default);
    }
  });
});
