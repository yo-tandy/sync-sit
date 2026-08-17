import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

/**
 * Authorization-only tests for getVerificationDocument.
 *
 * We deliberately do NOT exercise the Storage-emulator code paths
 * (file.exists(), getSignedUrl) because signed-URL generation requires
 * GCP credentials not available in offline emulator mode. These tests
 * cover the authn / authz / input-validation branches that fire BEFORE
 * any Storage call is made — which is the security-critical surface.
 */
describe('getVerificationDocument (authz)', () => {
  let seed: SeedData;
  let ownFamilyParentToken: string; // parent1 — member of family-dupont
  let otherFamilyParentToken: string; // parent3 — member of family-martin
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    ownFamilyParentToken = await getIdToken(seed.parent1.uid);
    otherFamilyParentToken = await getIdToken(seed.parent3.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  it('rejects unauthenticated callers', async () => {
    await expect(
      callFunction('getVerificationDocument', {
        filePath: `verification-documents/${seed.family1Id}/id.pdf`,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects empty filePath', async () => {
    await expect(
      callFunction('getVerificationDocument', { filePath: '' }, ownFamilyParentToken),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects filePath not starting with verification-documents/', async () => {
    await expect(
      callFunction(
        'getVerificationDocument',
        { filePath: 'other-bucket/family1/id.pdf' },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects filePath with too few segments', async () => {
    await expect(
      callFunction(
        'getVerificationDocument',
        { filePath: 'verification-documents/onlytwo' },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects parent from a different family', async () => {
    await expect(
      callFunction(
        'getVerificationDocument',
        { filePath: `verification-documents/${seed.family1Id}/id.pdf` },
        otherFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects babysitters (not a family member, not admin)', async () => {
    await expect(
      callFunction(
        'getVerificationDocument',
        { filePath: `verification-documents/${seed.family1Id}/id.pdf` },
        babysitterToken,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  // Authorization POSITIVES, re-homed from the deleted tutor-verification-access
  // suite. In offline emulator mode the Storage stage cannot succeed (signed
  // URLs need GCP credentials), so "authz passed" is proven by the call failing
  // AFTER the authz gate — any code except PERMISSION_DENIED / UNAUTHENTICATED.
  it('lets a legacy uploader read under their own uid (owner branch kept for retired tutor uploads)', async () => {
    const tutorToken = await getIdToken(seed.tutor1.uid);
    await expect(
      callFunction(
        'getVerificationDocument',
        { filePath: `verification-documents/${seed.tutor1.uid}/id.pdf` },
        tutorToken,
      ),
    ).rejects.toMatchObject({
      code: expect.not.stringMatching(/PERMISSION_DENIED|UNAUTHENTICATED/),
    });
  });

  it('lets an admin past the authz gate for any document', async () => {
    const adminToken = await getIdToken(seed.admin.uid);
    await expect(
      callFunction(
        'getVerificationDocument',
        { filePath: `verification-documents/${seed.family1Id}/id.pdf` },
        adminToken,
      ),
    ).rejects.toMatchObject({
      code: expect.not.stringMatching(/PERMISSION_DENIED|UNAUTHENTICATED/),
    });
  });

  it('lets a family member past the authz gate for their own family docs', async () => {
    await expect(
      callFunction(
        'getVerificationDocument',
        { filePath: `verification-documents/${seed.family1Id}/id.pdf` },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({
      code: expect.not.stringMatching(/PERMISSION_DENIED|UNAUTHENTICATED/),
    });
  });
});
