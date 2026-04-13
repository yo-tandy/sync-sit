import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

describe('admin functions', () => {
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

  describe('getAdminDashboard', () => {
    it('returns dashboard counts for admin', async () => {
      const result = await callFunction<{
        babysitterCount: number;
        familyCount: number;
        appointmentCount: number;
      }>('getAdminDashboard', {}, adminToken);

      expect(result.babysitterCount).toBeGreaterThanOrEqual(3); // 3 active babysitters
      expect(result.familyCount).toBeGreaterThanOrEqual(2);     // 2 families
    });

    it('rejects non-admin user', async () => {
      await expect(
        callFunction('getAdminDashboard', {}, parentToken)
      ).rejects.toThrow();
    });

    it('rejects unauthenticated call', async () => {
      await expect(
        callFunction('getAdminDashboard', {})
      ).rejects.toThrow();
    });
  });

  describe('blockUser', () => {
    it('blocks an active user', async () => {
      // Re-fetch admin token to ensure it's fresh
      const freshAdminToken = await getIdToken(seed.admin.uid);
      const result = await callFunction<{ success: boolean; newStatus: string }>(
        'blockUser',
        { targetUserId: seed.babysitter1.uid },
        freshAdminToken
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('blocked');

      // Verify in Firestore
      const db = getDb();
      const userDoc = await db.collection('users').doc(seed.babysitter1.uid).get();
      expect(userDoc.data()!.status).toBe('blocked');
    });

    it('unblocks a blocked user (toggle)', async () => {
      const freshAdminToken = await getIdToken(seed.admin.uid);
      const result = await callFunction<{ success: boolean; newStatus: string }>(
        'blockUser',
        { targetUserId: seed.babysitter1.uid },
        freshAdminToken
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('active');
    });

    it('rejects non-admin caller', async () => {
      await expect(
        callFunction('blockUser', { targetUserId: seed.babysitter2.uid }, parentToken)
      ).rejects.toThrow();
    });
  });
});
