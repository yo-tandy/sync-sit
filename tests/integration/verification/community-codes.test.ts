import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import {
  seedTestData,
  seedCommunityCode,
  type SeedData,
} from '../../setup/seed.js';

describe('community verification code flow', () => {
  let seed: SeedData;
  let verifiedEjmParentToken: string; // parent1 — family-dupont, verified EJM
  let unverifiedParentToken: string; // parent3 — family-martin, not verified
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    verifiedEjmParentToken = await getIdToken(seed.parent1.uid);
    unverifiedParentToken = await getIdToken(seed.parent3.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const codes = await db.collection('communityVerificationCodes').get();
    await Promise.all(codes.docs.map((d) => d.ref.delete()));
    // Reset family-martin to unverified state between tests
    await db.collection('families').doc(seed.family2Id).update({
      verification: {
        identityStatus: 'not_submitted',
        enrollmentStatus: 'not_submitted',
        isFullyVerified: false,
        isEjmFamily: false,
      },
    });
  });

  describe('generateCommunityCode', () => {
    it('unverified parent can generate a 6-char code stored in Firestore', async () => {
      const result = await callFunction<{ code: string; expiresAt: string }>(
        'generateCommunityCode',
        {},
        unverifiedParentToken,
      );

      expect(result.code).toMatch(/^[A-F0-9]{6}$/);
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const codeDoc = await getDb()
        .collection('communityVerificationCodes')
        .doc(result.code)
        .get();
      expect(codeDoc.data()!.familyId).toBe(seed.family2Id);
      expect(codeDoc.data()!.used).toBe(false);
    });

    it('deletes previous unused codes when a new one is generated', async () => {
      const first = await callFunction<{ code: string }>(
        'generateCommunityCode',
        {},
        unverifiedParentToken,
      );
      const second = await callFunction<{ code: string }>(
        'generateCommunityCode',
        {},
        unverifiedParentToken,
      );

      expect(first.code).not.toBe(second.code);

      const db = getDb();
      const firstDoc = await db
        .collection('communityVerificationCodes')
        .doc(first.code)
        .get();
      expect(firstDoc.exists).toBe(false);
    });

    it('rejects an already fully-verified family', async () => {
      await expect(
        callFunction('generateCommunityCode', {}, verifiedEjmParentToken),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    });

    it('rejects unauthenticated callers', async () => {
      await expect(callFunction('generateCommunityCode', {})).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('rejects non-parent roles (babysitter)', async () => {
      await expect(
        callFunction('generateCommunityCode', {}, babysitterToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });

  describe('lookupCommunityCode', () => {
    it('verified EJM parent can look up a valid code and see requester info', async () => {
      const code = await seedCommunityCode({
        familyId: seed.family2Id,
        requestedByUserId: seed.parent3.uid,
      });

      const result = await callFunction<{
        familyName: string;
        firstName: string;
        lastName: string;
        familyId: string;
      }>('lookupCommunityCode', { code }, verifiedEjmParentToken);

      expect(result.familyName).toBe('Martin');
      expect(result.firstName).toBe('Sophie');
      expect(result.lastName).toBe('Martin');
      expect(result.familyId).toBe(seed.family2Id);
    });

    it('rejects non-EJM / non-verified approver', async () => {
      const code = await seedCommunityCode({
        familyId: seed.family2Id,
        requestedByUserId: seed.parent3.uid,
      });
      await expect(
        callFunction('lookupCommunityCode', { code }, unverifiedParentToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('returns not-found for invalid code', async () => {
      await expect(
        callFunction(
          'lookupCommunityCode',
          { code: 'NOPE00' },
          verifiedEjmParentToken,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects expired code', async () => {
      const code = await seedCommunityCode({
        familyId: seed.family2Id,
        requestedByUserId: seed.parent3.uid,
        expiresAt: new Date(Date.now() - 60 * 1000),
      });
      await expect(
        callFunction('lookupCommunityCode', { code }, verifiedEjmParentToken),
      ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
    });

    it('rejects already-used code', async () => {
      const code = await seedCommunityCode({
        familyId: seed.family2Id,
        requestedByUserId: seed.parent3.uid,
        used: true,
        usedByUserId: seed.parent1.uid,
      });
      await expect(
        callFunction('lookupCommunityCode', { code }, verifiedEjmParentToken),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    });
  });

  describe('approveCommunityCode', () => {
    it('full happy path — approver marks requester family as fully verified', async () => {
      const code = await seedCommunityCode({
        familyId: seed.family2Id,
        requestedByUserId: seed.parent3.uid,
      });

      const result = await callFunction<{ success: boolean }>(
        'approveCommunityCode',
        { code },
        verifiedEjmParentToken,
      );
      expect(result.success).toBe(true);

      const db = getDb();
      const codeDoc = await db.collection('communityVerificationCodes').doc(code).get();
      expect(codeDoc.data()!.used).toBe(true);
      expect(codeDoc.data()!.usedByUserId).toBe(seed.parent1.uid);

      const familyDoc = await db.collection('families').doc(seed.family2Id).get();
      expect(familyDoc.data()!.verification.isFullyVerified).toBe(true);
      expect(familyDoc.data()!.verification.isEjmFamily).toBe(true);
      expect(familyDoc.data()!.verification.communityApprovedBy).toBe(seed.parent1.uid);
    });

    it('rejects self-approval (approver and requester same family)', async () => {
      // parent2 is in family1 (same as parent1/approver) — but family1 is already verified
      // so this test uses a code that claims to be for family1 itself
      const code = await seedCommunityCode({
        familyId: seed.family1Id, // same as verifiedEjmParent's family
        requestedByUserId: seed.parent1.uid,
      });
      await expect(
        callFunction('approveCommunityCode', { code }, verifiedEjmParentToken),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    });

    it('rejects non-verified approver', async () => {
      const code = await seedCommunityCode({
        familyId: seed.family2Id,
        requestedByUserId: seed.parent3.uid,
      });
      await expect(
        callFunction('approveCommunityCode', { code }, unverifiedParentToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });
});
