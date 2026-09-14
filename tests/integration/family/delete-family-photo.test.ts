import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { clearAll, callFunction, getIdToken, getBucket, getDb, STORAGE_BUCKET } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

/**
 * deleteFamilyPhoto (issue #483) — the membership-checked deleter that
 * closes the gap #482 deliberately left open (storage.rules' `delete`
 * was unscoped, `request.auth != null`). Unlike createFamilyPhotoUploadUrl
 * (which needs a real GCP signer the offline emulator cannot provide),
 * this callable's whole job — Admin SDK membership check, path guard,
 * Admin SDK delete, Firestore photoUrl cleanup — runs entirely against
 * the emulator, so every branch here is a REAL pass/fail, not a
 * "reached past the gate" proxy.
 */
describe('deleteFamilyPhoto', () => {
  let seed: SeedData;
  let ownFamilyParentToken: string; // parent1 — member of family-dupont
  let otherFamilyParentToken: string; // parent3 — member of family-martin
  let babysitterToken: string;
  let adminToken: string;

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

  afterEach(async () => {
    // Undo any photoUrl mutation a test made, and drop any objects a test
    // seeded — other tests in this file assume a clean families/{id} doc
    // and an empty family-photos/{familyId}/ prefix.
    await getDb().collection('families').doc(seed.family1Id).update({ photoUrl: null });
    await getDb().collection('families').doc(seed.family2Id).update({ photoUrl: null });
    const [files] = await getBucket().getFiles({ prefix: 'family-photos/' });
    await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));
  });

  async function seedObject(path: string): Promise<void> {
    await getBucket().file(path).save('fake-photo-bytes', { contentType: 'image/jpeg' });
  }

  async function objectExists(path: string): Promise<boolean> {
    const [exists] = await getBucket().file(path).exists();
    return exists;
  }

  it('rejects unauthenticated callers', async () => {
    await expect(
      callFunction('deleteFamilyPhoto', {
        familyId: seed.family1Id,
        objectPath: `family-photos/${seed.family1Id}/photo1.jpg`,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a missing familyId', async () => {
    await expect(
      callFunction(
        'deleteFamilyPhoto',
        { objectPath: `family-photos/${seed.family1Id}/photo1.jpg` },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a missing objectPath', async () => {
    await expect(
      callFunction('deleteFamilyPhoto', { familyId: seed.family1Id }, ownFamilyParentToken),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it("rejects an objectPath under a DIFFERENT family than the requested familyId (no traversal, no other family's path)", async () => {
    await expect(
      callFunction(
        'deleteFamilyPhoto',
        { familyId: seed.family1Id, objectPath: `family-photos/${seed.family2Id}/photo1.jpg` },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a nested sub-path under the family prefix', async () => {
    await expect(
      callFunction(
        'deleteFamilyPhoto',
        { familyId: seed.family1Id, objectPath: `family-photos/${seed.family1Id}/sub/photo1.jpg` },
        ownFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a parent from a different family (permission-denied)', async () => {
    await expect(
      callFunction(
        'deleteFamilyPhoto',
        { familyId: seed.family1Id, objectPath: `family-photos/${seed.family1Id}/photo1.jpg` },
        otherFamilyParentToken,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects babysitters (not a family member, not admin)', async () => {
    await expect(
      callFunction(
        'deleteFamilyPhoto',
        { familyId: seed.family1Id, objectPath: `family-photos/${seed.family1Id}/photo1.jpg` },
        babysitterToken,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it("deletes a member's own family's object, and clears photoUrl if it pointed there", async () => {
    const objectPath = `family-photos/${seed.family1Id}/photo1.jpg`;
    await seedObject(objectPath);
    await getDb()
      .collection('families')
      .doc(seed.family1Id)
      .update({
        photoUrl: `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(
          objectPath,
        )}?alt=media&token=abc`,
      });

    const result = await callFunction<{ success: boolean }>(
      'deleteFamilyPhoto',
      { familyId: seed.family1Id, objectPath },
      ownFamilyParentToken,
    );

    expect(result).toEqual({ success: true });
    expect(await objectExists(objectPath)).toBe(false);
    const familySnap = await getDb().collection('families').doc(seed.family1Id).get();
    expect(familySnap.data()?.photoUrl).toBeNull();
  });

  it("does NOT clear photoUrl when it points at a DIFFERENT object than the one deleted", async () => {
    const deletedPath = `family-photos/${seed.family1Id}/photo-old.jpg`;
    const currentPath = `family-photos/${seed.family1Id}/photo-current.jpg`;
    await seedObject(deletedPath);
    await getDb()
      .collection('families')
      .doc(seed.family1Id)
      .update({
        photoUrl: `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(
          currentPath,
        )}?alt=media&token=abc`,
      });

    await callFunction(
      'deleteFamilyPhoto',
      { familyId: seed.family1Id, objectPath: deletedPath },
      ownFamilyParentToken,
    );

    const familySnap = await getDb().collection('families').doc(seed.family1Id).get();
    expect(familySnap.data()?.photoUrl).toContain(encodeURIComponent(currentPath));
  });

  it('succeeds idempotently when the object does not exist (not-found)', async () => {
    const objectPath = `family-photos/${seed.family1Id}/never-uploaded.jpg`;
    const result = await callFunction<{ success: boolean }>(
      'deleteFamilyPhoto',
      { familyId: seed.family1Id, objectPath },
      ownFamilyParentToken,
    );
    expect(result).toEqual({ success: true });
  });

  it('lets an admin delete any family\'s object', async () => {
    const objectPath = `family-photos/${seed.family2Id}/photo1.jpg`;
    await seedObject(objectPath);

    const result = await callFunction<{ success: boolean }>(
      'deleteFamilyPhoto',
      { familyId: seed.family2Id, objectPath },
      adminToken,
    );

    expect(result).toEqual({ success: true });
    expect(await objectExists(objectPath)).toBe(false);
  });
});
