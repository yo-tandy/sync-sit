import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb, getAdminAuth } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

/**
 * "An admin cannot erase the last admin" (issue #421, option 2b).
 *
 * The guard lives in ONE place -- `guardAgainstLastAdmin` inside
 * `eraseUserAccount` (`admin/deleteUser.ts`) -- because both `deleteUser`
 * (admin-facing) and `deleteMyAccount` (self-serve) call it, the same reason
 * the erasure itself is shared (#368's own docblock). This suite exercises
 * BOTH callables against the ONE guard rather than re-testing the guard's
 * logic per callable.
 *
 * This is a PRECONDITION, not a denial of the erasure right (the GDPR
 * tension option 2a would have created): appoint a second admin and the
 * exact same call that was refused a moment ago succeeds.
 */
describe('last-admin governance', () => {
  let seed: SeedData;

  beforeEach(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  let counter = 0;
  /** A second real admin: its own Auth user and a `users` doc shaped like
   * `seedTestData`'s own admin fixture. */
  async function createAdmin(): Promise<{ uid: string; email: string }> {
    counter += 1;
    const email = `admin${counter}@syncsit.test`;
    const authUser = await getAdminAuth().createUser({ email, password: 'Test1234' });
    const uid = authUser.uid;
    await getDb()
      .collection('users')
      .doc(uid)
      .set({
        uid,
        isAdmin: true,
        email,
        status: 'active',
        firstName: `Admin${counter}`,
        lastName: 'Two',
        language: 'en',
        notifPrefs: {},
        fcmTokens: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    return { uid, email };
  }

  describe('deleteMyAccount (self-serve)', () => {
    it('the sole admin cannot delete their own account', async () => {
      const token = await getIdToken(seed.admin.uid);
      await expect(
        callFunction('deleteMyAccount', { confirm: 'DELETE' }, token),
      ).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { code: 'admin/last-admin' },
      });

      // The account survives, untouched.
      const doc = (await getDb().collection('users').doc(seed.admin.uid).get()).data()!;
      expect(doc.isAdmin).toBe(true);
      expect(doc.status).toBe('active');
      const authUser = await getAdminAuth().getUser(seed.admin.uid);
      expect(authUser.disabled).toBe(false);
    });

    it('an admin CAN delete their own account once a second admin exists', async () => {
      await createAdmin();
      const token = await getIdToken(seed.admin.uid);

      const result = await callFunction<{ success: boolean }>(
        'deleteMyAccount',
        { confirm: 'DELETE' },
        token,
      );
      expect(result.success).toBe(true);
      expect((await getDb().collection('users').doc(seed.admin.uid).get()).exists).toBe(false);
    });
  });

  describe('deleteUser (admin-facing)', () => {
    it('rejects deleting the sole admin', async () => {
      // The sole admin acting on the admin panel, targeting themselves --
      // still the same "would leave zero active admins" precondition.
      const token = await getIdToken(seed.admin.uid);
      await expect(
        callFunction('deleteUser', { targetUserId: seed.admin.uid }, token),
      ).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { code: 'admin/last-admin' },
      });

      const doc = (await getDb().collection('users').doc(seed.admin.uid).get()).data()!;
      expect(doc.isAdmin).toBe(true);
      expect(doc.status).toBe('active');
    });

    it('deletes an admin once a second admin exists to appoint', async () => {
      const second = await createAdmin();
      const token = await getIdToken(second.uid);

      const result = await callFunction<{ success: boolean }>(
        'deleteUser',
        { targetUserId: seed.admin.uid },
        token,
      );
      expect(result.success).toBe(true);
      expect((await getDb().collection('users').doc(seed.admin.uid).get()).exists).toBe(false);
      // The remaining admin is untouched.
      const remaining = (await getDb().collection('users').doc(second.uid).get()).data()!;
      expect(remaining.isAdmin).toBe(true);
      expect(remaining.status).toBe('active');
    });

    it('does not guard a non-admin target — the check is admin-specific', async () => {
      const token = await getIdToken(seed.admin.uid);
      const result = await callFunction<{ success: boolean }>(
        'deleteUser',
        { targetUserId: seed.babysitter1.uid },
        token,
      );
      expect(result.success).toBe(true);
    });

    it('does not guard an already-blocked admin (not counted as active)', async () => {
      // A blocked admin is not part of the "active admin" count in the first
      // place, so erasing them must not be refused on THIS account's own
      // (already-inactive) admin status.
      await getDb().collection('users').doc(seed.admin.uid).update({ status: 'blocked' });
      const second = await createAdmin();
      const token = await getIdToken(second.uid);

      const result = await callFunction<{ success: boolean }>(
        'deleteUser',
        { targetUserId: seed.admin.uid },
        token,
      );
      expect(result.success).toBe(true);
    });
  });
});
