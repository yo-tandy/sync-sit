import { describe, it, expect } from 'vitest';
import { createAdminConfigReader } from '@ejm/shared-ui';

/**
 * The shared client-side config reader (issue #250, round 3: one factory
 * for both apps). The six-case fallback matrix mirrors the server getter.
 */
const BOUNDS = { min: 1, max: 90 };

function readerFor(data: Record<string, unknown> | undefined) {
  return createAdminConfigReader(() => Promise.resolve({ data: () => data }));
}

describe('createAdminConfigReader', () => {
  it('returns the stored value when integer and in bounds', async () => {
    expect(await readerFor({ pastVisibilityDays: 30 }).getClientConfigValue('pastVisibilityDays', 7, BOUNDS)).toBe(30);
  });

  it('falls back on absent doc, absent key, non-integer, and out-of-bounds', async () => {
    for (const data of [undefined, {}, { k: 2.5 }, { k: '30' }, { k: 0 }, { k: 91 }]) {
      expect(await readerFor(data as never).getClientConfigValue('k', 7, BOUNDS)).toBe(7);
    }
  });

  it('falls back on an async read failure', async () => {
    const r = createAdminConfigReader(() => Promise.reject(new Error('offline')));
    expect(await r.getClientConfigValue('k', 7, BOUNDS)).toBe(7);
  });

  it('falls back when the fetch throws SYNCHRONOUSLY', async () => {
    const r = createAdminConfigReader(() => {
      throw new Error('no export');
    });
    expect(await r.getClientConfigValue('k', 7, BOUNDS)).toBe(7);
  });

  it('shares ONE fetch across reads until reset', async () => {
    let calls = 0;
    const r = createAdminConfigReader(() => {
      calls += 1;
      return Promise.resolve({ data: () => ({ k: 30 }) });
    });
    await r.getClientConfigValue('k', 7, BOUNDS);
    await r.getClientConfigValue('k', 7, BOUNDS);
    expect(calls).toBe(1);
    r.__resetAdminConfigClientCacheForTests();
    await r.getClientConfigValue('k', 7, BOUNDS);
    expect(calls).toBe(2);
  });
});
