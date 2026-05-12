import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

describe('submitVerification', () => {
  let seed: SeedData;
  let parent1Token: string;
  let parent3Token: string;
  let babysitterToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid); // verified EJM family (family-dupont)
    parent3Token = await getIdToken(seed.parent3.uid); // unverified family (family-martin)
    babysitterToken = await getIdToken(seed.babysitter1.uid);
    adminToken = await getIdToken(seed.admin.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const verifications = await db.collection('verifications').get();
    await Promise.all(verifications.docs.map((d) => d.ref.delete()));
    // Reset family-martin verification to not_submitted
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
    it('creates identity verification doc and marks family identityStatus=pending', async () => {
      const result = await callFunction<{ verificationId: string }>(
        'submitVerification',
        {
          type: 'identity',
          fileUrl: 'verification-documents/family-martin/id.pdf',
          fileName: 'id.pdf',
        },
        parent3Token,
      );

      expect(result.verificationId).toBeTruthy();

      const db = getDb();
      const doc = await db.collection('verifications').doc(result.verificationId).get();
      expect(doc.exists).toBe(true);
      expect(doc.data()!.familyId).toBe(seed.family2Id);
      expect(doc.data()!.uploadedByUserId).toBe(seed.parent3.uid);
      expect(doc.data()!.type).toBe('identity');
      expect(doc.data()!.status).toBe('pending');
      expect(doc.data()!.fileName).toBe('id.pdf');

      const familyDoc = await db.collection('families').doc(seed.family2Id).get();
      expect(familyDoc.data()!.verification.identityStatus).toBe('pending');
      expect(familyDoc.data()!.verification.isFullyVerified).toBe(false);
    });

    it('creates ejm_enrollment verification doc and marks family enrollmentStatus=pending', async () => {
      const result = await callFunction<{ verificationId: string }>(
        'submitVerification',
        {
          type: 'ejm_enrollment',
          fileUrl: 'verification-documents/family-martin/enroll.pdf',
          fileName: 'enroll.pdf',
          childName: 'Chloe Martin',
          signerName: 'Sophie Martin',
        },
        parent3Token,
      );

      const db = getDb();
      const doc = await db.collection('verifications').doc(result.verificationId).get();
      expect(doc.data()!.type).toBe('ejm_enrollment');
      expect(doc.data()!.status).toBe('pending');

      const familyDoc = await db.collection('families').doc(seed.family2Id).get();
      expect(familyDoc.data()!.verification.enrollmentStatus).toBe('pending');
    });

    it('resubmitting same type replaces the previous pending doc', async () => {
      const first = await callFunction<{ verificationId: string }>(
        'submitVerification',
        {
          type: 'identity',
          fileUrl: 'verification-documents/family-martin/id-v1.pdf',
          fileName: 'id-v1.pdf',
        },
        parent3Token,
      );

      const second = await callFunction<{ verificationId: string }>(
        'submitVerification',
        {
          type: 'identity',
          fileUrl: 'verification-documents/family-martin/id-v2.pdf',
          fileName: 'id-v2.pdf',
        },
        parent3Token,
      );

      expect(second.verificationId).not.toBe(first.verificationId);

      const db = getDb();
      const oldDoc = await db.collection('verifications').doc(first.verificationId).get();
      expect(oldDoc.exists).toBe(false);

      const newDoc = await db.collection('verifications').doc(second.verificationId).get();
      expect(newDoc.data()!.fileName).toBe('id-v2.pdf');
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated callers', async () => {
      await expect(
        callFunction('submitVerification', {
          type: 'identity',
          fileUrl: 'verification-documents/x/f.pdf',
          fileName: 'f.pdf',
        }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('rejects babysitters (only parents may submit)', async () => {
      await expect(
        callFunction(
          'submitVerification',
          {
            type: 'identity',
            fileUrl: 'verification-documents/x/f.pdf',
            fileName: 'f.pdf',
          },
          babysitterToken,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('rejects admins (only parents may submit)', async () => {
      await expect(
        callFunction(
          'submitVerification',
          {
            type: 'identity',
            fileUrl: 'verification-documents/x/f.pdf',
            fileName: 'f.pdf',
          },
          adminToken,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('rejects missing required fields (type)', async () => {
      await expect(
        callFunction(
          'submitVerification',
          { fileUrl: 'verification-documents/x/f.pdf', fileName: 'f.pdf' },
          parent1Token,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('rejects missing required fields (fileUrl)', async () => {
      await expect(
        callFunction(
          'submitVerification',
          { type: 'identity', fileName: 'f.pdf' },
          parent1Token,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('rejects missing required fields (fileName)', async () => {
      await expect(
        callFunction(
          'submitVerification',
          { type: 'identity', fileUrl: 'verification-documents/x/f.pdf' },
          parent1Token,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });
  });
});
