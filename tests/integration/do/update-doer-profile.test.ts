import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb, getAdminAuth } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// doUpdateDoerProfile (§8): categories / bio / transport / notifyNewTasks /
// defaultRate, validated with the do-core bounds; NEVER touches
// enrollmentComplete (the §7.2 board gate is server-owned state this
// callable must be structurally unable to reach).

const DOER_UID = 'doer-update-1';

describe('doUpdateDoerProfile', () => {
  let seed: SeedData;
  let token: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    await getAdminAuth().createUser({ uid: DOER_UID, email: 'doer.update@ejm.org' });
    await getDb().collection('users').doc(DOER_UID).set({
      uid: DOER_UID,
      email: 'doer.update@ejm.org',
      status: 'active',
      firstName: 'Upd',
      lastName: 'Ater',
      dateOfBirth: new Date('2008-03-15'),
      ejemEmail: 'doer.update@ejm.org',
      profiles: {
        doer: {
          enrollmentComplete: true,
          notifyNewTasks: true,
          categories: ['green_thumb', 'boxes', 'ikea', 'party', 'it', 'errands', 'pet_house'],
          bio: null,
          defaultRate: null,
          hasCar: false,
          hasBike: false,
        },
      },
      notifPrefs: {},
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    token = await getIdToken(DOER_UID);
  });

  afterAll(async () => {
    await clearAll();
  });

  it('rejects unauthenticated calls', async () => {
    await expect(
      callFunction('doUpdateDoerProfile', { bio: 'hi' }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects an account with no doer profile', async () => {
    const noDoerToken = await getIdToken(seed.babysitter3.uid);
    await expect(
      callFunction('doUpdateDoerProfile', { bio: 'hi' }, noDoerToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('partial update writes exactly the supplied fields and leaves the rest — enrollmentComplete included', async () => {
    await callFunction('doUpdateDoerProfile', {
      categories: ['ikea', 'it'],
      bio: '  Good with flat-packs.  ',
      notifyNewTasks: false,
      defaultRate: 25,
    }, token);

    const doer = (await getDb().collection('users').doc(DOER_UID).get()).data()!.profiles.doer;
    expect(doer.categories).toEqual(['ikea', 'it']);
    expect(doer.bio).toBe('Good with flat-packs.'); // trimmed
    expect(doer.notifyNewTasks).toBe(false);
    expect(doer.defaultRate).toBe(25);
    // Untouched fields survive a dot-path partial update.
    expect(doer.hasCar).toBe(false);
    expect(doer.hasBike).toBe(false);
    expect(doer.enrollmentComplete).toBe(true);
  });

  it('transport toggles and null-clears round-trip', async () => {
    await callFunction('doUpdateDoerProfile', {
      hasCar: true,
      hasBike: true,
      bio: null,
      defaultRate: null,
    }, token);

    const doer = (await getDb().collection('users').doc(DOER_UID).get()).data()!.profiles.doer;
    expect(doer.hasCar).toBe(true);
    expect(doer.hasBike).toBe(true);
    expect(doer.bio).toBeNull();
    expect(doer.defaultRate).toBeNull();
  });

  it('an EMPTY categories array is valid — the explicit "no digests" state (§3.3, never "all")', async () => {
    await callFunction('doUpdateDoerProfile', { categories: [] }, token);
    const doer = (await getDb().collection('users').doc(DOER_UID).get()).data()!.profiles.doer;
    expect(doer.categories).toEqual([]);
  });

  it('rejects unknown and duplicate categories', async () => {
    await expect(
      callFunction('doUpdateDoerProfile', { categories: ['ikea', 'plumbing'] }, token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      callFunction('doUpdateDoerProfile', { categories: ['ikea', 'ikea'] }, token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects an overlong bio (do-core bound)', async () => {
    await expect(
      callFunction('doUpdateDoerProfile', { bio: 'x'.repeat(1001) }, token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects an out-of-range defaultRate (shared price bounds)', async () => {
    await expect(
      callFunction('doUpdateDoerProfile', { defaultRate: 1001 }, token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      callFunction('doUpdateDoerProfile', { defaultRate: -1 }, token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects non-boolean toggles and an empty payload', async () => {
    await expect(
      callFunction('doUpdateDoerProfile', { notifyNewTasks: 'yes' }, token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      callFunction('doUpdateDoerProfile', {}, token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('a smuggled enrollmentComplete field is unreachable: ignored by the whitelist, flag untouched', async () => {
    // Set it false on the doc's twin field name — the update map is built
    // only from the six whitelisted keys, so this must be a no-op plus the
    // valid hasCar write.
    await callFunction('doUpdateDoerProfile', {
      enrollmentComplete: false,
      hasCar: false,
    }, token);
    const doer = (await getDb().collection('users').doc(DOER_UID).get()).data()!.profiles.doer;
    expect(doer.enrollmentComplete).toBe(true);
    expect(doer.hasCar).toBe(false);
  });

  it('a blocked account cannot update', async () => {
    await getDb().collection('users').doc(DOER_UID).update({ status: 'blocked' });
    try {
      await expect(
        callFunction('doUpdateDoerProfile', { hasBike: false }, token),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    } finally {
      await getDb().collection('users').doc(DOER_UID).update({ status: 'active' });
    }
  });
});
