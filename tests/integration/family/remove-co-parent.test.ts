import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

/**
 * removeCoParent clears the target's membership pointer
 * (profiles.parent.familyId -- Plan D; plus the legacy root familyId) and
 * trims them from the family.parentIds array. It does NOT delete the user
 * doc or the auth account (that's deleteUser's job); the family-less
 * parent profile that remains is re-attachable via a fresh invite. Tests
 * re-seed each time because a successful run mutates parent2's user doc
 * and the family doc.
 */
describe('removeCoParent', () => {
  let seed: SeedData;
  let parent1Token: string;
  let babysitterToken: string;

  beforeEach(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  describe('happy paths', () => {
    it('parent removes their co-parent: parentIds trimmed, target user familyId cleared', async () => {
      // Pre-state: the membership field is POPULATED, so the post-call
      // undefined below is the callable's doing, not the seed's shape.
      const preDoc = await getDb().collection('users').doc(seed.parent2.uid).get();
      expect(preDoc.data()!.profiles?.parent?.familyId).toBe(seed.family1Id);

      const result = await callFunction<{ success: boolean }>(
        'removeCoParent',
        { targetUserId: seed.parent2.uid },
        parent1Token,
      );

      expect(result.success).toBe(true);

      const db = getDb();
      const familyDoc = await db.collection('families').doc(seed.family1Id).get();
      expect(familyDoc.data()!.parentIds).toEqual([seed.parent1.uid]);

      const targetDoc = await db.collection('users').doc(seed.parent2.uid).get();
      // User doc still exists (NOT deleted)
      expect(targetDoc.exists).toBe(true);
      // Membership is cleared where it LIVES (Plan D): the old pin on the
      // root field passed vacuously -- Plan D never populates it, so it was
      // undefined before the call too (issue #279). Pin the field the
      // callable's own gate reads, and prove it was populated pre-call by
      // the seed (a delete of an absent field would pass just as vacuously).
      expect(targetDoc.data()!.profiles?.parent?.familyId).toBeUndefined();
      expect(targetDoc.data()!.familyId).toBeUndefined();
      // The removed co-parent keeps their parent PROFILE (they can re-join
      // a family by invite); only the membership pointer goes.
      expect(targetDoc.data()!.profiles?.parent).toBeDefined();

      // Audit log written
      const logs = await db
        .collection('auditLogs')
        .where('action', '==', 'remove_co_parent')
        .where('adminUserId', '==', seed.parent1.uid)
        .get();
      expect(logs.docs).toHaveLength(1);
    });
  });

  describe('happy-path variants (issue #279 / PR #284 review)', () => {
    it('a TRUE legacy Plan C doc (root-only membership) can be removed, both fields cleared', async () => {
      // Round 4: the gate now accepts EITHER membership field, so a doc
      // whose membership lives only at the root -- the exact shape the
      // retained root delete exists for -- is removable. Seeded root-only:
      // the Plan D pointer is deleted first, root set, so this pin covers
      // the legacy shape rather than a hybrid.
      const FieldValue = (await import('firebase-admin/firestore')).FieldValue;
      await getDb().collection('users').doc(seed.parent2.uid).update({
        familyId: seed.family1Id,
        'profiles.parent.familyId': FieldValue.delete(),
      });
      const pre = (await getDb().collection('users').doc(seed.parent2.uid).get()).data()!;
      expect(pre.familyId).toBe(seed.family1Id);
      expect(pre.profiles?.parent?.familyId).toBeUndefined();

      await callFunction('removeCoParent', { targetUserId: seed.parent2.uid }, parent1Token);

      const post = (await getDb().collection('users').doc(seed.parent2.uid).get()).data()!;
      expect(post.familyId).toBeUndefined();
      expect(post.profiles?.parent?.familyId).toBeUndefined();
      const fam = await getDb().collection('families').doc(seed.family1Id).get();
      expect(fam.data()!.parentIds).not.toContain(seed.parent2.uid);
    });

    it('the #279 consequence is closed: a removed co-parent is DENIED verification-document access', async () => {
      await callFunction('removeCoParent', { targetUserId: seed.parent2.uid }, parent1Token);
      const parent2Token = await getIdToken(seed.parent2.uid);
      // Membership is checked before any storage access, so no document
      // needs to exist -- the denial is the pin.
      await expect(
        callFunction(
          'getVerificationDocument',
          { filePath: `verification-documents/${seed.family1Id}/id-card.png` },
          parent2Token,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('removal is recoverable: a fresh invite re-attaches the orphan parent profile', async () => {
      // Give the orphan profile a field that must SURVIVE the re-attach
      // (the merge-write pin: a whole-map replace would drop it).
      await getDb().collection('users').doc(seed.parent2.uid)
        .update({ 'profiles.parent.phone': '+33 699999999' });
      await callFunction('removeCoParent', { targetUserId: seed.parent2.uid }, parent1Token);

      const token = 'token-rejoin-279';
      await getDb().collection('inviteLinks').doc(token).set({
        token, familyId: seed.family1Id, familyName: 'TestFamily',
        createdByUserId: seed.parent1.uid,
        expiresAt: new Date(Date.now() + 86400_000), used: false, createdAt: new Date(),
      });
      const parent2Token = await getIdToken(seed.parent2.uid);
      const res = await callFunction<{ success: boolean }>('joinFamily', { token }, parent2Token);
      expect(res.success).toBe(true);

      const doc = await getDb().collection('users').doc(seed.parent2.uid).get();
      expect(doc.data()!.profiles?.parent?.familyId).toBe(seed.family1Id);
      expect(doc.data()!.profiles?.parent?.phone).toBe('+33 699999999');
      const fam = await getDb().collection('families').doc(seed.family1Id).get();
      expect(fam.data()!.parentIds).toContain(seed.parent2.uid);
    });

    it('a parent profile WITH a familyId still cannot join another family (carve-out is orphan-only)', async () => {
      // The other family must EXIST so joinFamily reaches the profile gate
      // rather than rejecting NOT_FOUND on the family doc.
      await getDb().collection('families').doc('family-other-279').set({
        familyId: 'family-other-279', familyName: 'Other', parentIds: [],
        status: 'active', createdAt: new Date(), updatedAt: new Date(),
      });
      const token = 'token-still-member-279';
      await getDb().collection('inviteLinks').doc(token).set({
        token, familyId: 'family-other-279', familyName: 'Other',
        createdByUserId: seed.parent1.uid,
        expiresAt: new Date(Date.now() + 86400_000), used: false, createdAt: new Date(),
      });
      const parent2Token = await getIdToken(seed.parent2.uid);
      await expect(
        callFunction('joinFamily', { token }, parent2Token),
      ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated callers', async () => {
      await expect(
        callFunction('removeCoParent', { targetUserId: seed.parent2.uid }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('rejects babysitters (only parents may call)', async () => {
      await expect(
        callFunction(
          'removeCoParent',
          { targetUserId: seed.parent2.uid },
          babysitterToken,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('rejects removing yourself', async () => {
      await expect(
        callFunction(
          'removeCoParent',
          { targetUserId: seed.parent1.uid },
          parent1Token,
        ),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    });

    it('rejects targeting a user in a different family', async () => {
      await expect(
        callFunction(
          'removeCoParent',
          { targetUserId: seed.parent3.uid },
          parent1Token,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects targeting a non-existent user', async () => {
      await expect(
        callFunction(
          'removeCoParent',
          { targetUserId: 'no-such-user' },
          parent1Token,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects missing targetUserId', async () => {
      await expect(
        callFunction('removeCoParent', {}, parent1Token),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });
  });
});
