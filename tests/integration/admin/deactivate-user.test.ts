import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

describe('deactivateUser', () => {
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

  describe('happy paths', () => {
    it('toggles active babysitter to non-searchable', async () => {
      // babysitter1 is seeded with searchable: true
      const result = await callFunction<{ searchable: boolean }>(
        'deactivateUser',
        { targetUserId: seed.babysitter1.uid },
        adminToken,
      );

      expect(result.searchable).toBe(false);
      const userDoc = await getDb().collection('users').doc(seed.babysitter1.uid).get();
      expect(userDoc.data()!.searchable).toBe(false);
    });

    it('toggles inactive babysitter back to searchable (reactivate)', async () => {
      // babysitter4 is seeded with searchable: false
      const result = await callFunction<{ searchable: boolean }>(
        'deactivateUser',
        { targetUserId: seed.babysitter4.uid },
        adminToken,
      );

      expect(result.searchable).toBe(true);
      const userDoc = await getDb().collection('users').doc(seed.babysitter4.uid).get();
      expect(userDoc.data()!.searchable).toBe(true);
    });

    it('writes an audit log entry with action reflecting direction', async () => {
      // babysitter1 was just deactivated in the first test — flip back so we
      // observe an activate_user log this time
      await callFunction('deactivateUser', { targetUserId: seed.babysitter1.uid }, adminToken);

      const logs = await getDb()
        .collection('auditLogs')
        .where('targetUserId', '==', seed.babysitter1.uid)
        .get();
      const actions = logs.docs.map((d) => d.data().action);
      expect(actions).toContain('deactivate_user');
      expect(actions).toContain('activate_user');
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated callers', async () => {
      await expect(
        callFunction('deactivateUser', { targetUserId: seed.babysitter1.uid }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('rejects non-admin (parent) callers', async () => {
      await expect(
        callFunction(
          'deactivateUser',
          { targetUserId: seed.babysitter1.uid },
          parentToken,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('rejects non-babysitter target (parent)', async () => {
      await expect(
        callFunction(
          'deactivateUser',
          { targetUserId: seed.parent1.uid },
          adminToken,
        ),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    });

    it('returns not-found for missing user', async () => {
      await expect(
        callFunction('deactivateUser', { targetUserId: 'nope' }, adminToken),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects missing targetUserId', async () => {
      await expect(
        callFunction('deactivateUser', {}, adminToken),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });
  });
});
