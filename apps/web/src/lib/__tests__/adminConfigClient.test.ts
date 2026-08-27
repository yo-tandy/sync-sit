import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The client-side config reader (issue #250) must share the server
 * getter's fallback semantics exactly: absent doc, absent key,
 * non-integer, or out-of-bounds all resolve to the caller's default, one
 * fetch is shared across reads, and a SYNCHRONOUSLY-throwing firestore
 * (the CI failure that motivated the hardening) degrades identically.
 */
const h = vi.hoisted(() => ({
  getDoc: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ __doc: path.join('/') }),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
}));

import { getClientConfigValue, __resetAdminConfigClientCacheForTests } from '../adminConfigClient';

const BOUNDS = { min: 1, max: 90 };

beforeEach(() => {
  h.getDoc.mockReset();
  __resetAdminConfigClientCacheForTests();
});

describe('getClientConfigValue', () => {
  it('returns the stored value when integer and in bounds', async () => {
    h.getDoc.mockResolvedValue({ data: () => ({ pastVisibilityDays: 30 }) });
    expect(await getClientConfigValue('pastVisibilityDays', 7, BOUNDS)).toBe(30);
  });

  it('falls back on absent doc, absent key, non-integer, and out-of-bounds', async () => {
    for (const data of [undefined, {}, { pastVisibilityDays: 2.5 }, { pastVisibilityDays: '30' }, { pastVisibilityDays: 0 }, { pastVisibilityDays: 91 }]) {
      __resetAdminConfigClientCacheForTests();
      h.getDoc.mockResolvedValue({ data: () => data });
      expect(await getClientConfigValue('pastVisibilityDays', 7, BOUNDS)).toBe(7);
    }
  });

  it('falls back on an async read failure', async () => {
    h.getDoc.mockRejectedValue(new Error('offline'));
    expect(await getClientConfigValue('pastVisibilityDays', 7, BOUNDS)).toBe(7);
  });

  it('falls back when getDoc throws SYNCHRONOUSLY (mock-shaped environments)', async () => {
    h.getDoc.mockImplementation(() => {
      throw new Error('no export');
    });
    expect(await getClientConfigValue('pastVisibilityDays', 7, BOUNDS)).toBe(7);
  });

  it('shares ONE fetch across reads (module-level promise)', async () => {
    h.getDoc.mockResolvedValue({ data: () => ({ pastVisibilityDays: 30 }) });
    await getClientConfigValue('pastVisibilityDays', 7, BOUNDS);
    await getClientConfigValue('pastVisibilityDays', 7, BOUNDS);
    expect(h.getDoc).toHaveBeenCalledTimes(1);
  });
});
