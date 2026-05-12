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
});
