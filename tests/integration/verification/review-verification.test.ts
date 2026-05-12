import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedVerification, type SeedData } from '../../setup/seed.js';

describe('reviewVerification', () => {
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
    // Reset family-martin to unverified
    await db.collection('families').doc(seed.family2Id).update({
      verification: {
        identityStatus: 'not_submitted',
        enrollmentStatus: 'not_submitted',
        isFullyVerified: false,
        isEjmFamily: false,
      },
    });
  });

  describe('happy paths', () => {
    it('admin approves identity doc → family.identityStatus=approved', async () => {
      const verificationId = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
      });

      const result = await callFunction<{ success: boolean; isFullyVerified: boolean }>(
        'reviewVerification',
        { verificationId, decision: 'approved' },
        adminToken,
      );

      expect(result.success).toBe(true);
      expect(result.isFullyVerified).toBe(false); // enrollment still pending

      const db = getDb();
      const verDoc = await db.collection('verifications').doc(verificationId).get();
      expect(verDoc.data()!.status).toBe('approved');
      expect(verDoc.data()!.reviewedByAdminId).toBe(seed.admin.uid);
      expect(verDoc.data()!.reviewedAt).toBeDefined();

      const familyDoc = await db.collection('families').doc(seed.family2Id).get();
      expect(familyDoc.data()!.verification.identityStatus).toBe('approved');
      expect(familyDoc.data()!.verification.isFullyVerified).toBe(false);
    });

    it('admin approves ejm_enrollment → family.isEjmFamily=true', async () => {
      const verificationId = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'ejm_enrollment',
      });

      await callFunction(
        'reviewVerification',
        { verificationId, decision: 'approved' },
        adminToken,
      );

      const familyDoc = await getDb().collection('families').doc(seed.family2Id).get();
      expect(familyDoc.data()!.verification.enrollmentStatus).toBe('approved');
      expect(familyDoc.data()!.verification.isEjmFamily).toBe(true);
    });

    it('approving both identity and enrollment → isFullyVerified=true', async () => {
      const idVerification = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
      });
      const enrollVerification = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'ejm_enrollment',
      });

      await callFunction(
        'reviewVerification',
        { verificationId: idVerification, decision: 'approved' },
        adminToken,
      );
      const result = await callFunction<{ success: boolean; isFullyVerified: boolean }>(
        'reviewVerification',
        { verificationId: enrollVerification, decision: 'approved' },
        adminToken,
      );

      expect(result.isFullyVerified).toBe(true);

      const familyDoc = await getDb().collection('families').doc(seed.family2Id).get();
      expect(familyDoc.data()!.verification.isFullyVerified).toBe(true);
      expect(familyDoc.data()!.verification.isEjmFamily).toBe(true);
    });

    it('admin rejects with reason → status=rejected, reason stored', async () => {
      const verificationId = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
      });

      await callFunction(
        'reviewVerification',
        { verificationId, decision: 'rejected', rejectionReason: 'Document unreadable' },
        adminToken,
      );

      const verDoc = await getDb().collection('verifications').doc(verificationId).get();
      expect(verDoc.data()!.status).toBe('rejected');
      expect(verDoc.data()!.rejectionReason).toBe('Document unreadable');

      const familyDoc = await getDb().collection('families').doc(seed.family2Id).get();
      expect(familyDoc.data()!.verification.identityStatus).toBe('rejected');
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated callers', async () => {
      await expect(
        callFunction('reviewVerification', { verificationId: 'x', decision: 'approved' }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('rejects non-admin (parent) callers', async () => {
      const verificationId = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
      });
      await expect(
        callFunction(
          'reviewVerification',
          { verificationId, decision: 'approved' },
          parentToken,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('rejects missing verificationId', async () => {
      await expect(
        callFunction('reviewVerification', { decision: 'approved' }, adminToken),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('rejects reject-decision without reason', async () => {
      const verificationId = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
      });
      await expect(
        callFunction(
          'reviewVerification',
          { verificationId, decision: 'rejected' },
          adminToken,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('returns not-found for missing verificationId', async () => {
      await expect(
        callFunction(
          'reviewVerification',
          { verificationId: 'does-not-exist', decision: 'approved' },
          adminToken,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
