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

  /**
   * The same lockout, reachable through `blockUser` (issue #500).
   *
   * `blockUser` sets `status: 'blocked'` AND disables the Firebase Auth
   * account, so a blocked admin cannot sign back in to undo it. #490 closed
   * this for erasure and left it open here; both now share one guard
   * (`admin/lastAdmin.ts`), and this block exercises it through the blocking
   * path rather than re-testing the shared logic.
   */
  describe('blockUser (#500)', () => {
    it('the sole active admin cannot block themselves', async () => {
      const token = await getIdToken(seed.admin.uid);

      await expect(
        callFunction('blockUser', { targetUserId: seed.admin.uid }, token),
      ).rejects.toMatchObject({ details: { code: 'admin/last-admin' } });

      // ...and the account is untouched: still active, still signable-in.
      const after = await getDb().collection('users').doc(seed.admin.uid).get();
      expect(after.data()?.status).toBe('active');
      const authUser = await getAdminAuth().getUser(seed.admin.uid);
      expect(authUser.disabled).toBe(false);
    });

    it('an admin who is themselves mid-erasure cannot block the only OTHER eligible admin', async () => {
      // Caller and target differ, and the caller is NOT a survivor: a live
      // `erasureStartedAt` marker (a concurrent erasure of the caller, still
      // in flight) excludes them from the count exactly as it does for
      // erasure, so the target is the last eligible admin and blocking them
      // must be refused -- even though two docs are `active`.
      const second = await createAdmin();
      await getDb().collection('users').doc(seed.admin.uid).update({ erasureStartedAt: new Date() });
      const token = await getIdToken(seed.admin.uid);

      await expect(
        callFunction('blockUser', { targetUserId: second.uid }, token),
      ).rejects.toMatchObject({ details: { code: 'admin/last-admin' } });
      expect((await getDb().collection('users').doc(second.uid).get()).data()?.status).toBe('active');
    });

    it('succeeds once a second active admin exists', async () => {
      // The precondition clears: the exact call refused above now works.
      await createAdmin();
      const token = await getIdToken(seed.admin.uid);

      const result = await callFunction<{ success: boolean; newStatus: string }>(
        'blockUser',
        { targetUserId: seed.admin.uid },
        token,
      );
      expect(result).toMatchObject({ success: true, newStatus: 'blocked' });
      expect((await getAdminAuth().getUser(seed.admin.uid)).disabled).toBe(true);
    });

    it('never guards UNBLOCKING — that direction adds an admin back', async () => {
      // Gating the safe direction would make a zero-admin state unrecoverable
      // through the product itself.
      await getDb().collection('users').doc(seed.admin.uid).update({ status: 'blocked' });
      await getAdminAuth().updateUser(seed.admin.uid, { disabled: true });
      const second = await createAdmin();
      const token = await getIdToken(second.uid);

      const result = await callFunction<{ success: boolean; newStatus: string }>(
        'blockUser',
        { targetUserId: seed.admin.uid },
        token,
      );
      expect(result).toMatchObject({ success: true, newStatus: 'active' });
      expect((await getAdminAuth().getUser(seed.admin.uid)).disabled).toBe(false);
    });

    it('two admins blocking each other leaves exactly one usable admin', async () => {
      // HONEST LIMITATION, measured — do not read this as proof that the
      // transaction serializes. Mutation-tested while writing it: moving the
      // admin count OUTSIDE the transaction (keeping the guard itself) leaves
      // all 11 tests in this file green, because two `callFunction` round
      // trips through the emulator do not overlap tightly enough for the
      // second to read before the first commits. Production Cloud Run runs
      // concurrent instances and genuinely can, which is why the count stays
      // inside the transaction regardless.
      //
      // What this test DOES pin: the guard holds under a double-fire rather
      // than letting both through, and the admin left standing is actually
      // usable (active AND not disabled in Auth) rather than merely counted.
      // That is worth having; it is just not a serialization proof.
      const second = await createAdmin();
      const tokenA = await getIdToken(seed.admin.uid);
      const tokenB = await getIdToken(second.uid);

      const results = await Promise.allSettled([
        callFunction('blockUser', { targetUserId: second.uid }, tokenA),
        callFunction('blockUser', { targetUserId: seed.admin.uid }, tokenB),
      ]);

      const ok = results.filter((r) => r.status === 'fulfilled');
      expect(ok).toHaveLength(1);

      // The survivor is genuinely usable, which is the property that matters.
      const admins = await getDb()
        .collection('users')
        .where('isAdmin', '==', true)
        .where('status', '==', 'active')
        .get();
      expect(admins.size).toBe(1);
      expect((await getAdminAuth().getUser(admins.docs[0].id)).disabled).toBe(false);
    });
  });
});
