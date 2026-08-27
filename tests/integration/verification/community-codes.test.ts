import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import {
  seedTestData,
  seedCommunityCode,
  seedVerification,
  type SeedData,
} from '../../setup/seed.js';

describe('community verification code flow', () => {
  let seed: SeedData;
  let verifiedEjmParentToken: string; // parent1 — family-dupont, verified EJM
  let unverifiedParentToken: string; // parent3 — family-martin, not verified
  let babysitterToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    verifiedEjmParentToken = await getIdToken(seed.parent1.uid);
    unverifiedParentToken = await getIdToken(seed.parent3.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
    adminToken = await getIdToken(seed.admin.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const codes = await db.collection('communityVerificationCodes').get();
    await Promise.all(codes.docs.map((d) => d.ref.delete()));
    // Verification docs too — the supersede tests below seed their own and
    // would otherwise read each other's leftovers.
    const verifications = await db.collection('verifications').get();
    await Promise.all(verifications.docs.map((d) => d.ref.delete()));
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

    // Issue #218 — the document request must not outlive the approval.
    it('supersedes the family\'s pending document requests', async () => {
      const db = getDb();
      const pendingId = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
      });
      const code = await seedCommunityCode({
        familyId: seed.family2Id,
        requestedByUserId: seed.parent3.uid,
      });

      await callFunction('approveCommunityCode', { code }, verifiedEjmParentToken);

      const doc = await db.collection('verifications').doc(pendingId).get();
      expect(doc.data()!.status).toBe('superseded');
      expect(doc.data()!.supersededBy).toBe('community');
      expect(doc.data()!.supersededAt).toBeTruthy();
      // The file reference survives — superseding must not orphan the upload.
      expect(doc.data()!.fileUrl).toBeTruthy();
    });

    it('drops the superseded request out of the admin pending queue', async () => {
      await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
      });
      const code = await seedCommunityCode({
        familyId: seed.family2Id,
        requestedByUserId: seed.parent3.uid,
      });

      await callFunction('approveCommunityCode', { code }, verifiedEjmParentToken);

      const { verifications } = await callFunction<{
        verifications: { familyId: string; status: string }[];
      }>('listPendingVerifications', { statusFilter: 'pending' }, adminToken);

      expect(verifications.filter((v) => v.familyId === seed.family2Id)).toHaveLength(0);
    });

    it('closes a REJECTED document too — the family routed around it', async () => {
      // A rejected doc is as moot as a pending one once the community route
      // has vouched, and leaving it live was a real bug: reviewVerification
      // recomputes from documents, so a stale rejection would un-verify the
      // family on the next approval (PR #220 review).
      const db = getDb();
      const rejectedId = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
        status: 'rejected',
      });
      const code = await seedCommunityCode({
        familyId: seed.family2Id,
        requestedByUserId: seed.parent3.uid,
      });

      await callFunction('approveCommunityCode', { code }, verifiedEjmParentToken);

      const doc = await db.collection('verifications').doc(rejectedId).get();
      expect(doc.data()!.status).toBe('superseded');
      expect(doc.data()!.supersededBy).toBe('community');
      // The file reference survives here too — superseding must not orphan it.
      expect(doc.data()!.fileUrl).toBeTruthy();
    });

    it('leaves APPROVED documents alone — an approval is not made moot', async () => {
      const db = getDb();
      const approvedId = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'ejm_enrollment',
        status: 'approved',
      });
      const code = await seedCommunityCode({
        familyId: seed.family2Id,
        requestedByUserId: seed.parent3.uid,
      });

      await callFunction('approveCommunityCode', { code }, verifiedEjmParentToken);

      const doc = await db.collection('verifications').doc(approvedId).get();
      expect(doc.data()!.status).toBe('approved');
      expect(doc.data()!.supersededAt).toBeUndefined();
    });

    it('refuses a code whose family is already verified, naming the reason', async () => {
      const db = getDb();
      const code = await seedCommunityCode({
        familyId: seed.family2Id,
        requestedByUserId: seed.parent3.uid,
      });
      // Admin (or another parent) got there first.
      await db.collection('families').doc(seed.family2Id).update({
        verification: {
          identityStatus: 'approved',
          enrollmentStatus: 'approved',
          isFullyVerified: true,
          isEjmFamily: true,
        },
      });

      await expect(
        callFunction('approveCommunityCode', { code }, verifiedEjmParentToken),
      ).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { reason: 'already_verified' },
      });

      // The code must survive a refused attempt — it was never consumed.
      const codeDoc = await db.collection('communityVerificationCodes').doc(code).get();
      expect(codeDoc.data()!.used).toBe(false);
    });
  });

  describe('lookupCommunityCode — stale request', () => {
    it('refuses a code whose family is already verified, naming the reason', async () => {
      const db = getDb();
      const code = await seedCommunityCode({
        familyId: seed.family2Id,
        requestedByUserId: seed.parent3.uid,
      });
      await db.collection('families').doc(seed.family2Id).update({
        verification: {
          identityStatus: 'approved',
          enrollmentStatus: 'approved',
          isFullyVerified: true,
          isEjmFamily: true,
        },
      });

      await expect(
        callFunction('lookupCommunityCode', { code }, verifiedEjmParentToken),
      ).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { reason: 'already_verified' },
      });
    });
  });
});
