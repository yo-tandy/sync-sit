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

  // Issue #218 — a community approval vouches for BOTH types. Re-approving one
  // document later must not silently revoke the other.
  describe('community-granted families', () => {
    async function grantCommunityApproval() {
      await getDb().collection('families').doc(seed.family2Id).update({
        verification: {
          identityStatus: 'approved',
          enrollmentStatus: 'approved',
          isFullyVerified: true,
          isEjmFamily: true,
          communityApprovedBy: seed.parent1.uid,
        },
      });
    }

    it('approving a new enrollment doc keeps the community identity approval', async () => {
      await grantCommunityApproval();
      // The identity doc that was pending when the community vouched.
      await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
        status: 'superseded',
      });
      // Next school year's certificate.
      const enrollVerification = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'ejm_enrollment',
      });

      const result = await callFunction<{ isFullyVerified: boolean }>(
        'reviewVerification',
        { verificationId: enrollVerification, decision: 'approved' },
        adminToken,
      );

      expect(result.isFullyVerified).toBe(true);

      const verification = (await getDb().collection('families').doc(seed.family2Id).get())
        .data()!.verification;
      expect(verification.identityStatus).toBe('approved');
      expect(verification.isFullyVerified).toBe(true);
      expect(verification.communityApprovedBy).toBe(seed.parent1.uid);
    });

    it('an explicit rejection still wins over the grant for that type', async () => {
      await grantCommunityApproval();
      const idVerification = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
      });

      await callFunction(
        'reviewVerification',
        { verificationId: idVerification, decision: 'rejected', rejectionReason: 'Expired ID' },
        adminToken,
      );

      const verification = (await getDb().collection('families').doc(seed.family2Id).get())
        .data()!.verification;
      expect(verification.identityStatus).toBe('rejected');
      expect(verification.isFullyVerified).toBe(false);
      // Enrollment had no document of its own, so the grant still covers it.
      expect(verification.enrollmentStatus).toBe('approved');
      expect(verification.communityApprovedBy).toBe(seed.parent1.uid);
    });

    it('a PRE-GRANT rejection does not revoke the grant on a later approval', async () => {
      // The bug this pins (PR #220 review): approveCommunityCode superseded
      // only `pending` docs, so a doc an admin had already REJECTED before the
      // family routed around it via the community code stayed live. The next
      // time an admin approved anything for that family, the recompute read
      // that stale rejection and silently un-verified a community-approved
      // family — through an APPROVAL. Reachable with no unusual steps.
      const staleReject = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
      });
      await callFunction(
        'reviewVerification',
        { verificationId: staleReject, decision: 'rejected', rejectionReason: 'Blurry' },
        adminToken,
      );

      // The family gives up on documents and asks a friend to vouch. The
      // grant must close the rejected doc, not just pending ones.
      await grantCommunityApproval();
      const rejectedDoc = (await getDb().collection('verifications').doc(staleReject).get()).data()!;
      expect(rejectedDoc.status).toBe('superseded');
      expect(rejectedDoc.supersededBy).toBe('community');

      // Next school year's certificate, approved.
      const enrollVerification = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'ejm_enrollment',
      });
      const result = await callFunction<{ isFullyVerified: boolean }>(
        'reviewVerification',
        { verificationId: enrollVerification, decision: 'approved' },
        adminToken,
      );

      expect(result.isFullyVerified).toBe(true);
      const verification = (await getDb().collection('families').doc(seed.family2Id).get())
        .data()!.verification;
      expect(verification.identityStatus).toBe('approved');
      expect(verification.isFullyVerified).toBe(true);
    });

    it('a live PENDING doc of the other type does not drop the grant mid-review', async () => {
      // `pending` is not a decision. A family that uploads both documents
      // after being community-verified used to fall to isFullyVerified: false
      // (and lose isEjmFamily) for the whole window between the first
      // approval and the second review — an outcome no admin chose.
      await grantCommunityApproval();
      await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'ejm_enrollment',
      });
      const idVerification = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
      });

      await callFunction(
        'reviewVerification',
        { verificationId: idVerification, decision: 'approved' },
        adminToken,
      );

      const verification = (await getDb().collection('families').doc(seed.family2Id).get())
        .data()!.verification;
      expect(verification.identityStatus).toBe('approved');
      expect(verification.enrollmentStatus).toBe('approved');
      expect(verification.isFullyVerified).toBe(true);
      expect(verification.isEjmFamily).toBe(true);
    });

    it('leaves a document-verified family untouched (no grant, no baseline)', async () => {
      const idVerification = await seedVerification({
        familyId: seed.family2Id,
        uploadedByUserId: seed.parent3.uid,
        type: 'identity',
      });

      await callFunction(
        'reviewVerification',
        { verificationId: idVerification, decision: 'approved' },
        adminToken,
      );

      const verification = (await getDb().collection('families').doc(seed.family2Id).get())
        .data()!.verification;
      expect(verification.identityStatus).toBe('approved');
      expect(verification.enrollmentStatus).toBe('not_submitted');
      expect(verification.isFullyVerified).toBe(false);
      expect(verification.communityApprovedBy).toBeUndefined();
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

    it('refuses a legacy familyId-less doc BEFORE mutating it (retired tutor_identity shape)', async () => {
      // Shape left behind by the retired tutor flow: no familyId. Written
      // directly (not via seedVerification) because the helper requires one.
      const db = getDb();
      const ref = db.collection('verifications').doc();
      await ref.set({
        verificationId: ref.id,
        uploadedByUserId: seed.parent1.uid,
        type: 'tutor_identity',
        status: 'pending',
        fileUrl: `verification-documents/${seed.parent1.uid}/id.pdf`,
        fileName: 'id.pdf',
        createdAt: new Date(),
      });

      await expect(
        callFunction(
          'reviewVerification',
          { verificationId: ref.id, decision: 'approved' },
          adminToken,
        ),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

      // The guard must fire before any write: the doc is untouched.
      const after = await ref.get();
      expect(after.data()!.status).toBe('pending');
      expect(after.data()!.reviewedByAdminId).toBeUndefined();
    });
  });
});
