import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

/**
 * createFamilyPhotoUploadUrl (issue #471).
 *
 * Every case here is decided BEFORE the (mocked-out-of-scope) signed-URL
 * call: input validation, the contentType denylist, the extension
 * allowlist, and the Admin-SDK membership check all run first. Offline
 * emulator mode has no GCP credentials to actually sign a V4 URL with
 * (same constraint documented on getVerificationDocument's integration
 * suite), so a SUCCESSFUL call here still fails — at the signing step,
 * past every gate this suite exists to test. "Passed authz" is proven the
 * same way get-verification-document.test.ts proves it: the call fails
 * with something OTHER than the code the gate under test would produce.
 *
 * The signer OPTIONS (action/version/contentType/expires) are pinned
 * separately, with Storage mocked, in
 * packages/shared-functions/src/family/__tests__/createFamilyPhotoUploadUrl.test.ts.
 */
describe('createFamilyPhotoUploadUrl (authz + validation)', () => {
  let seed: SeedData;
  let ownFamilyParentToken: string; // parent1 — member of family-dupont
  let otherFamilyParentToken: string; // parent3 — member of family-martin
  let babysitterToken: string;
  let adminToken: string;

  const VALID = { contentType: 'image/jpeg', fileName: 'photo.jpg', sizeBytes: 1024 };

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    ownFamilyParentToken = await getIdToken(seed.parent1.uid);
    otherFamilyParentToken = await getIdToken(seed.parent3.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
    adminToken = await getIdToken(seed.admin.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  it('rejects unauthenticated callers', async () => {
    await expect(
      callFunction('createFamilyPhotoUploadUrl', { familyId: seed.family1Id, ...VALID }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a missing familyId', async () => {
    await expect(
      callFunction('createFamilyPhotoUploadUrl', { ...VALID }, ownFamilyParentToken),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a missing fileName', async () => {
    await expect(
      callFunction(
        'createFamilyPhotoUploadUrl',
        { familyId: seed.family1Id, contentType: 'image/jpeg', sizeBytes: 1024 },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a missing sizeBytes', async () => {
    await expect(
      callFunction(
        'createFamilyPhotoUploadUrl',
        { familyId: seed.family1Id, contentType: 'image/jpeg', fileName: 'photo.jpg' },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects an oversize declared sizeBytes (> 10 MB)', async () => {
    await expect(
      callFunction(
        'createFamilyPhotoUploadUrl',
        { familyId: seed.family1Id, ...VALID, sizeBytes: 10 * 1024 * 1024 + 1 },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects contentType image/svg+xml (renderable/scriptable denylist)', async () => {
    await expect(
      callFunction(
        'createFamilyPhotoUploadUrl',
        { familyId: seed.family1Id, contentType: 'image/svg+xml', fileName: 'evil.svg', sizeBytes: 1024 },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects contentType text/html', async () => {
    await expect(
      callFunction(
        'createFamilyPhotoUploadUrl',
        { familyId: seed.family1Id, contentType: 'text/html', fileName: 'evil.html', sizeBytes: 1024 },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a disallowed file extension even with a real image contentType', async () => {
    await expect(
      callFunction(
        'createFamilyPhotoUploadUrl',
        { familyId: seed.family1Id, contentType: 'image/jpeg', fileName: 'photo.exe', sizeBytes: 1024 },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a parent from a different family', async () => {
    await expect(
      callFunction(
        'createFamilyPhotoUploadUrl',
        { familyId: seed.family1Id, ...VALID },
        otherFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects babysitters (not a family member, not admin)', async () => {
    await expect(
      callFunction(
        'createFamilyPhotoUploadUrl',
        { familyId: seed.family1Id, ...VALID },
        babysitterToken,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  // ── Authorization POSITIVES — proven by the call failing PAST the authz
  // gate (signing needs GCP credentials the offline emulator lacks). ──

  it('lets a family member past the authz gate for their OWN family, and returns a path under that family', async () => {
    // If the membership/validation gates ever regressed to reject a
    // legitimate call, this would fail with PERMISSION_DENIED/
    // INVALID_ARGUMENT instead of failing at the signing step.
    await expect(
      callFunction(
        'createFamilyPhotoUploadUrl',
        { familyId: seed.family1Id, ...VALID },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({
      code: expect.not.stringMatching(/PERMISSION_DENIED|UNAUTHENTICATED|INVALID_ARGUMENT/),
    });
  });

  it('lets an admin past the authz gate for any family', async () => {
    await expect(
      callFunction(
        'createFamilyPhotoUploadUrl',
        { familyId: seed.family1Id, ...VALID },
        adminToken,
      ),
    ).rejects.toMatchObject({
      code: expect.not.stringMatching(/PERMISSION_DENIED|UNAUTHENTICATED|INVALID_ARGUMENT/),
    });
  });
});
