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
 *
 * `blockUser` (issue #500) shares the count (`countEligibleActiveAdmins`)
 * and the refusal: blocking disables the Auth account in the same call, so a
 * sole admin blocked away is the same lockout as a sole admin erased. Its
 * cases sit in this suite for the same reason the two erasure callables do
 * -- one guard, exercised through every door.
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

  describe('blockUser (issue #500)', () => {
    it('the sole admin cannot block themselves -- doc and Auth untouched', async () => {
      const token = await getIdToken(seed.admin.uid);
      await expect(
        callFunction('blockUser', { targetUserId: seed.admin.uid }, token),
      ).rejects.toMatchObject({
        code: 'FAILED_PRECONDITION',
        details: { code: 'admin/last-admin' },
      });

      const doc = (await getDb().collection('users').doc(seed.admin.uid).get()).data()!;
      expect(doc.status).toBe('active');
      expect(doc.isAdmin).toBe(true);
      const authUser = await getAdminAuth().getUser(seed.admin.uid);
      expect(authUser.disabled).toBe(false);
    });

    it('blocks an admin once a second admin exists, and disables their Auth account', async () => {
      const second = await createAdmin();
      const token = await getIdToken(second.uid);

      const result = await callFunction<{ success: boolean; newStatus: string }>(
        'blockUser',
        { targetUserId: seed.admin.uid },
        token,
      );
      expect(result).toEqual({ success: true, newStatus: 'blocked' });
      expect((await getDb().collection('users').doc(seed.admin.uid).get()).data()!.status).toBe(
        'blocked',
      );
      expect((await getAdminAuth().getUser(seed.admin.uid)).disabled).toBe(true);
    });

    it('never guards an UNBLOCK -- it only ever adds an admin back', async () => {
      // Two admins, one already blocked: the remaining sole active admin
      // unblocking the other must not be refused on the count (which is
      // exactly one, and about to become two).
      const second = await createAdmin();
      await getDb().collection('users').doc(second.uid).update({ status: 'blocked' });
      const token = await getIdToken(seed.admin.uid);

      const result = await callFunction<{ success: boolean; newStatus: string }>(
        'blockUser',
        { targetUserId: second.uid },
        token,
      );
      expect(result).toEqual({ success: true, newStatus: 'active' });
      expect((await getAdminAuth().getUser(second.uid)).disabled).toBe(false);
    });

    it('does not guard a non-admin target -- the check is admin-specific', async () => {
      const token = await getIdToken(seed.admin.uid);
      const result = await callFunction<{ success: boolean; newStatus: string }>(
        'blockUser',
        { targetUserId: seed.babysitter1.uid },
        token,
      );
      expect(result.newStatus).toBe('blocked');
    });

    it('two admins blocking each other at the same moment: exactly one succeeds', async () => {
      // The race the transaction exists for. Both calls read a count of two;
      // whichever commits first flips a doc the other one read, so the other
      // is retried against the new state and refuses. A read-then-write
      // without the transaction lets both pass and leaves zero active admins.
      const second = await createAdmin();
      const [tokenA, tokenB] = await Promise.all([
        getIdToken(seed.admin.uid),
        getIdToken(second.uid),
      ]);

      const outcomes = await Promise.allSettled([
        callFunction('blockUser', { targetUserId: second.uid }, tokenA),
        callFunction('blockUser', { targetUserId: seed.admin.uid }, tokenB),
      ]);
      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter(
        (o): o is PromiseRejectedResult => o.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({ details: { code: 'admin/last-admin' } });

      // And the invariant itself: one active admin remains, never zero.
      const active = await getDb()
        .collection('users')
        .where('isAdmin', '==', true)
        .where('status', '==', 'active')
        .get();
      expect(active.size).toBe(1);
    });
  });
});
