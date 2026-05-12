import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedVerification, type SeedData } from '../../setup/seed.js';

interface StatusResponse {
  verification: {
    identityStatus: string;
    enrollmentStatus: string;
    isFullyVerified: boolean;
    isEjmFamily: boolean;
  };
  documents: Array<{ id: string; familyId: string; type: string; status: string }>;
}

describe('getVerificationStatus', () => {
  let seed: SeedData;
  let parent1Token: string;
  let parent3Token: string;
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
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
    it("returns caller's own family verification status", async () => {
      // family-dupont is seeded as fully verified EJM family
      const result = await callFunction<StatusResponse>(
        'getVerificationStatus',
        {},
        parent1Token,
      );

      expect(result.verification.isFullyVerified).toBe(true);
      expect(result.verification.isEjmFamily).toBe(true);
      expect(result.verification.identityStatus).toBe('approved');
      expect(result.verification.enrollmentStatus).toBe('approved');
      expect(result.documents).toEqual([]);
    });

    it('returns default not_submitted for unverified family with no docs', async () => {
      const result = await callFunction<StatusResponse>(
        'getVerificationStatus',
        {},
        parent3Token,
      );

      expect(result.verification.identityStatus).toBe('not_submitted');
      expect(result.verification.enrollmentStatus).toBe('not_submitted');
      expect(result.verification.isFullyVerified).toBe(false);
    });

    it('includes own family verification docs only (does not leak other families)', async () => {
      // Seed a verification doc for family-dupont and one for family-martin
      await seedVerification({
        familyId: seed.family1Id,
        uploadedByUserId: seed.parent1.uid,
        type: 'identity',
        status: 'approved',
      });
      await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
        status: 'pending',
      });

      const parent1Result = await callFunction<StatusResponse>(
        'getVerificationStatus',
        {},
        parent1Token,
      );
      const parent3Result = await callFunction<StatusResponse>(
        'getVerificationStatus',
        {},
        parent3Token,
      );

      expect(parent1Result.documents).toHaveLength(1);
      expect(parent1Result.documents[0].familyId).toBe(seed.family1Id);
      expect(parent1Result.documents[0].status).toBe('approved');

      expect(parent3Result.documents).toHaveLength(1);
      expect(parent3Result.documents[0].familyId).toBe(seed.family2Id);
      expect(parent3Result.documents[0].status).toBe('pending');
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated callers', async () => {
      await expect(callFunction('getVerificationStatus', {})).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('rejects non-parent roles (babysitter)', async () => {
      await expect(
        callFunction('getVerificationStatus', {}, babysitterToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });
});
