import { describe, it, expect, afterEach } from 'vitest';
import { ttlMs } from '@ejm/shared-functions/config/adminConfig.js';

/**
 * Round-8 review: the TTL parser's matrix, incl. the round-4 blank-env
 * guard -- Number('') is 0, so a DECLARED-but-blank ADMIN_CONFIG_TTL_MS
 * would have silently disabled prod caching. CI sets 0 job-wide, so
 * nothing else exercises the parsing.
 */
describe('ttlMs (env parsing)', () => {
  const KEY = 'ADMIN_CONFIG_TTL_MS';
  afterEach(() => {
    delete process.env[KEY];
  });

  it('unset -> the 60s default', () => {
    delete process.env[KEY];
    expect(ttlMs()).toBe(60_000);
  });

  it('blank and whitespace-only read as UNSET, not 0 (round-4 guard)', () => {
    process.env[KEY] = '';
    expect(ttlMs()).toBe(60_000);
    process.env[KEY] = '   ';
    expect(ttlMs()).toBe(60_000);
  });

  it("'0' disables caching (always refetch)", () => {
    process.env[KEY] = '0';
    expect(ttlMs()).toBe(0);
  });

  it('a positive integer is used as-is', () => {
    process.env[KEY] = '5000';
    expect(ttlMs()).toBe(5000);
  });

  it('garbage and negatives fall back to the default', () => {
    process.env[KEY] = 'abc';
    expect(ttlMs()).toBe(60_000);
    process.env[KEY] = '-1';
    expect(ttlMs()).toBe(60_000);
    process.env[KEY] = 'NaN';
    expect(ttlMs()).toBe(60_000);
  });
});
