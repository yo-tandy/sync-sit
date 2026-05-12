import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedVerification, type SeedData } from '../../setup/seed.js';

interface ListResponse {
  verifications: Array<{
    id: string;
    familyId: string;
    type: string;
    status: string;
    familyName: string;
    parentName: string;
    familyKids: Array<{ firstName: string; age: number }>;
    familyParentNames: string[];
  }>;
}

describe('listPendingVerifications', () => {
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
    const verifications = await db.collection('verifications').get();
    await Promise.all(verifications.docs.map((d) => d.ref.delete()));
  });

  describe('happy paths', () => {
    it('admin lists all verifications enriched with family/parent info', async () => {
      await seedVerification({
        familyId: seed.family1Id,
        uploadedByUserId: seed.parent1.uid,
        type: 'identity',
        status: 'pending',
      });
      await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'ejm_enrollment',
        status: 'pending',
      });

      const result = await callFunction<ListResponse>(
        'listPendingVerifications',
        {},
        adminToken,
      );

      expect(result.verifications).toHaveLength(2);
      const dupont = result.verifications.find((v) => v.familyId === seed.family1Id);
      expect(dupont?.familyName).toBe('Dupont');
      expect(dupont?.parentName).toBe('Marie Dupont');
      expect(dupont?.familyKids.length).toBeGreaterThan(0);
      expect(dupont?.familyParentNames).toEqual(
        expect.arrayContaining(['Marie Dupont', 'Pierre Dupont']),
      );
    });

    it('filters by status (approved only)', async () => {
      await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
        status: 'pending',
      });
      await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'ejm_enrollment',
        status: 'approved',
        reviewedByAdminId: seed.admin.uid,
      });

      const result = await callFunction<ListResponse>(
        'listPendingVerifications',
        { statusFilter: 'approved' },
        adminToken,
      );

      expect(result.verifications).toHaveLength(1);
      expect(result.verifications[0].status).toBe('approved');
    });

    it('filters by type (identity only)', async () => {
      await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
        status: 'pending',
      });
      await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'ejm_enrollment',
        status: 'pending',
      });

      const result = await callFunction<ListResponse>(
        'listPendingVerifications',
        { typeFilter: 'identity' },
        adminToken,
      );

      expect(result.verifications).toHaveLength(1);
      expect(result.verifications[0].type).toBe('identity');
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated callers', async () => {
      await expect(callFunction('listPendingVerifications', {})).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('rejects non-admin (parent) callers', async () => {
      await expect(
        callFunction('listPendingVerifications', {}, parentToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });
});
