import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

/**
 * removeCoParent unsets the target's familyId and trims them from the
 * family.parentIds array. It does NOT delete the user doc or the auth
 * account (that's deleteUser's job). Tests re-seed each time because a
 * successful run mutates parent2's user doc and the family doc.
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
      // familyId field unset
      expect(targetDoc.data()!.familyId).toBeUndefined();

      // Audit log written
      const logs = await db
        .collection('auditLogs')
        .where('action', '==', 'remove_co_parent')
        .where('adminUserId', '==', seed.parent1.uid)
        .get();
      expect(logs.docs).toHaveLength(1);
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
