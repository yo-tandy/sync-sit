import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

function dateFromNow(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

function publishPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'one_time',
    date: dateFromNow(2),
    startTime: '18:00',
    endTime: '22:00',
    kidIds: ['kid1'],
    offeredRate: 15,
    ...overrides,
  };
}

/**
 * Admin-panel configuration (issue #250). The effect pins require the
 * functions emulator to run with ADMIN_CONFIG_TTL_MS=0 (the lane command
 * sets it) so a written value is visible to the very next callable
 * invocation instead of hiding behind the 60s cache.
 */
describe('adminConfig', () => {
  let seed: SeedData;
  let adminToken: string;
  let parentToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
    parentToken = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.doc('adminConfig/values').delete().catch(() => {});
    const pub = await db.collection('publishedSearches').get();
    await Promise.all(pub.docs.map((d) => d.ref.delete()));
  });

  describe('getAdminConfig', () => {
    it('rejects a non-admin caller', async () => {
      try {
        await callFunction('getAdminConfig', {}, parentToken);
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('PERMISSION_DENIED');
      }
    });

    it('returns the definition table plus stored values', async () => {
      await getDb().doc('adminConfig/values').set({ publishedSearchMaxActive: 5 });
      const res = await callFunction<{
        defs: Record<string, { default: number; min: number; max: number; description: string }>;
        values: Record<string, number>;
      }>('getAdminConfig', {}, adminToken);
      expect(res.defs.publishedSearchMaxActive.default).toBe(3);
      expect(res.defs.boardContactsPerDay).toMatchObject({ default: 5, min: 1, max: 50 });
      expect(res.values.publishedSearchMaxActive).toBe(5);
    });
  });

  describe('updateAdminConfig', () => {
    it('rejects a non-admin caller', async () => {
      try {
        await callFunction('updateAdminConfig', { updates: { publishedSearchMaxActive: 5 } }, parentToken);
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('PERMISSION_DENIED');
      }
    });

    it('rejects unknown keys, non-integers, and out-of-bounds values', async () => {
      for (const updates of [
        { notAKey: 5 },
        { publishedSearchMaxActive: 2.5 },
        { publishedSearchMaxActive: '3' },
        { publishedSearchMaxActive: 0 },
        { publishedSearchMaxActive: 21 },
      ]) {
        try {
          await callFunction('updateAdminConfig', { updates }, adminToken);
          throw new Error(`should have thrown for ${JSON.stringify(updates)}`);
        } catch (err) {
          expect((err as { code?: string }).code).toBe('INVALID_ARGUMENT');
        }
      }
      // Nothing was written by the rejected calls.
      expect((await getDb().doc('adminConfig/values').get()).exists).toBe(false);
    });

    it('merges partial updates and writes an audit entry with before/after', async () => {
      await callFunction('updateAdminConfig', { updates: { publishedSearchMaxActive: 5 } }, adminToken);
      await callFunction('updateAdminConfig', { updates: { boardContactsPerDay: 10 } }, adminToken);
      const doc = (await getDb().doc('adminConfig/values').get()).data()!;
      expect(doc.publishedSearchMaxActive).toBe(5);
      expect(doc.boardContactsPerDay).toBe(10);

      const logs = await getDb().collection('auditLogs')
        .where('action', '==', 'admin_config_updated').get();
      expect(logs.size).toBeGreaterThanOrEqual(2);
      const entries = logs.docs.map((d) => d.data());
      expect(entries.some((e) =>
        (e.details as { changes?: Record<string, { from: unknown; to: number }> })
          ?.changes?.publishedSearchMaxActive?.to === 5,
      )).toBe(true);
    });
  });

  it('null reverts a key: the field is DELETED and the audit records to: null', async () => {
    await callFunction('updateAdminConfig', { updates: { publishedSearchMaxActive: 5 } }, adminToken);
    await callFunction('updateAdminConfig', { updates: { publishedSearchMaxActive: null } }, adminToken);
    const doc = (await getDb().doc('adminConfig/values').get()).data()!;
    expect('publishedSearchMaxActive' in doc).toBe(false);
    const logs = await getDb().collection('auditLogs')
      .where('action', '==', 'admin_config_updated').get();
    expect(logs.docs.map((d) => d.data()).some((e) =>
      (e.details as { changes?: Record<string, { to: unknown }> })
        ?.changes?.publishedSearchMaxActive?.to === null,
    )).toBe(true);
  });

  describe('effect on callables (ADMIN_CONFIG_TTL_MS=0)', () => {
    it('a lowered publishedSearchMaxActive takes effect: second publish rejected at cap 1', async () => {
      await callFunction('updateAdminConfig', { updates: { publishedSearchMaxActive: 1 } }, adminToken);
      await callFunction('publishSearch', publishPayload(), parentToken);
      try {
        await callFunction('publishSearch', publishPayload({ date: dateFromNow(3) }), parentToken);
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('RESOURCE_EXHAUSTED');
      }
    });

    it('an out-of-bounds value planted by a rogue console edit falls back to the code default', async () => {
      // Bypass the callable (admin SDK write): 999 is far past the max (20).
      await getDb().doc('adminConfig/values').set({ publishedSearchMaxActive: 999 });
      // Default is 3: publishes 1-3 pass, the 4th is rejected -- the rogue
      // 999 never takes effect.
      for (let i = 0; i < 3; i++) {
        await callFunction('publishSearch', publishPayload({ date: dateFromNow(2 + i) }), parentToken);
      }
      try {
        await callFunction('publishSearch', publishPayload({ date: dateFromNow(6) }), parentToken);
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('RESOURCE_EXHAUSTED');
      }
    });

    it('absent doc means code defaults: three publishes pass, the fourth is rejected', async () => {
      for (let i = 0; i < 3; i++) {
        await callFunction('publishSearch', publishPayload({ date: dateFromNow(2 + i) }), parentToken);
      }
      try {
        await callFunction('publishSearch', publishPayload({ date: dateFromNow(6) }), parentToken);
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('RESOURCE_EXHAUSTED');
      }
    });
  });
});
