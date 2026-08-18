import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb, getAdminAuth } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// signOutEverywhere (issue #181): logout means logout EVERYWHERE. The callable
// bumps the server-owned users/{uid}.sessionEpoch (both apps watch the doc and
// force-sign-out on a newer epoch) and revokes refresh tokens as the backstop
// for sessions that miss the watch.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('signOutEverywhere', () => {
  let seed: SeedData;
  let parent1Token: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  it('bumps sessionEpoch, revokes refresh tokens and writes an audit entry', async () => {
    const uid = seed.parent1.uid;
    const before = await getDb().collection('users').doc(uid).get();
    expect(before.data()!.sessionEpoch).toBeUndefined();
    const beforeUser = await getAdminAuth().getUser(uid);
    const beforeValidMs = beforeUser.tokensValidAfterTime
      ? Date.parse(beforeUser.tokensValidAfterTime)
      : 0;

    // tokensValidAfterTime has 1s resolution — make the advance unambiguous.
    await sleep(1100);
    const res = await callFunction<{ ok: boolean }>('signOutEverywhere', {}, parent1Token);
    expect(res).toEqual({ ok: true });

    // 1. sessionEpoch is now a server timestamp.
    const after = await getDb().collection('users').doc(uid).get();
    const epoch = after.data()!.sessionEpoch as Timestamp;
    expect(epoch).toBeInstanceOf(Timestamp);
    // ...and only sessionEpoch changed — the rest of the doc is intact.
    expect(after.data()!.email).toBe(before.data()!.email);
    expect(after.data()!.status).toBe(before.data()!.status);

    // 2. Refresh tokens are revoked: tokensValidAfterTime advanced.
    const afterUser = await getAdminAuth().getUser(uid);
    expect(afterUser.tokensValidAfterTime).toBeTruthy();
    expect(Date.parse(afterUser.tokensValidAfterTime!)).toBeGreaterThan(beforeValidMs);

    // 3. Audit entry for the actor.
    const logs = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'signed_out_everywhere')
      .get();
    const mine = logs.docs.filter((d) => d.data().adminUserId === uid);
    expect(mine.length).toBe(1);
  });

  it('a second call advances the epoch (each logout is a NEWER epoch)', async () => {
    const uid = seed.parent1.uid;
    const first = (await getDb().collection('users').doc(uid).get()).data()!
      .sessionEpoch as Timestamp;

    await sleep(50);
    await callFunction('signOutEverywhere', {}, parent1Token);

    const second = (await getDb().collection('users').doc(uid).get()).data()!
      .sessionEpoch as Timestamp;
    expect(second.toMillis()).toBeGreaterThan(first.toMillis());
  });

  it('rejects unauthenticated calls', async () => {
    await expect(callFunction('signOutEverywhere', {})).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});
