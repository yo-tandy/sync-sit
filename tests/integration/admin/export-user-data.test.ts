import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

interface ExportResponse {
  user: { id: string; email: string; profiles?: { parent?: unknown; babysitter?: unknown } };
  family: { id: string; familyName: string } | null;
  appointments: Array<{ id: string }>;
  notifications: Array<{ id: string }>;
  auditLogs: Array<{ id: string; action: string }>;
}

describe('exportUserData', () => {
  let seed: SeedData;
  let adminToken: string;
  let parentToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
    parentToken = await getIdToken(seed.parent1.uid);

    // Side data for parent1
    await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
    });
    const db = getDb();
    await db.collection('notifications').add({
      recipientUserId: seed.parent1.uid,
      type: 'confirmed',
      createdAt: new Date(),
    });
    await db.collection('auditLogs').add({
      adminUserId: seed.admin.uid,
      action: 'block_user',
      targetUserId: seed.parent1.uid,
      timestamp: new Date(),
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  describe('happy paths', () => {
    it('exports a parent: user, family, appointments, notifications, audit logs', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.parent1.uid },
        adminToken,
      );

      expect(result.user.id).toBe(seed.parent1.uid);
      expect(result.user.email).toBe(seed.parent1.email);
      expect(result.user.profiles?.parent).toBeTruthy();

      expect(result.family).not.toBeNull();
      expect(result.family!.id).toBe(seed.family1Id);
      expect(result.family!.familyName).toBe('Dupont');

      expect(result.appointments.length).toBeGreaterThanOrEqual(1);
      expect(result.notifications.length).toBeGreaterThanOrEqual(1);
      // Pre-seeded block_user audit log targeting parent1 should be returned
      const actions = result.auditLogs.map((a) => a.action);
      expect(actions).toContain('block_user');
    });

    it('exports a babysitter: family is null, babysitter appointments included', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.babysitter1.uid },
        adminToken,
      );

      expect(result.user.profiles?.babysitter).toBeTruthy();
      expect(result.family).toBeNull();
      expect(result.appointments.length).toBeGreaterThanOrEqual(1);
    });

    it('deduplicates appointments where the user is both family-member and babysitter (or duplicated query)', async () => {
      const result = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.parent1.uid },
        adminToken,
      );

      const ids = result.appointments.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated callers', async () => {
      await expect(
        callFunction('exportUserData', { targetUserId: seed.parent1.uid }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('rejects non-admin (parent) callers', async () => {
      await expect(
        callFunction(
          'exportUserData',
          { targetUserId: seed.parent1.uid },
          parentToken,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('returns not-found for missing user', async () => {
      await expect(
        callFunction('exportUserData', { targetUserId: 'nope' }, adminToken),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
