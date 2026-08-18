import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb, getAdminAuth } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// signOutEverywhere (issue #181): logout means logout EVERYWHERE. The callable
// bumps the server-owned users/{uid}.sessionEpoch (both apps watch the doc and
// force-sign-out on a newer epoch) and revokes refresh tokens as the backstop
// for sessions that miss the watch.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Count 'signed_out_everywhere' audit rows for a uid (order-independent). */
async function auditCount(uid: string): Promise<number> {
  const logs = await getDb()
    .collection('auditLogs')
    .where('action', '==', 'signed_out_everywhere')
    .get();
  return logs.docs.filter((d) => d.data().adminUserId === uid).length;
}

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
    const auditBefore = await auditCount(uid);

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

    // 3. Exactly ONE new audit entry for the actor (delta, not an absolute
    // count — keeps the pin decoupled from other cases in this file).
    expect(await auditCount(uid)).toBe(auditBefore + 1);
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

  it('targets only the caller: a second caller bumps their own doc, not others', async () => {
    const parent2Token = await getIdToken(seed.parent2.uid);
    // Order-independent: parent1's epoch may or may not exist yet depending
    // on which cases ran — the pin is only that it does not CHANGE.
    const parent1Before = (
      await getDb().collection('users').doc(seed.parent1.uid).get()
    ).data()!.sessionEpoch as Timestamp | undefined;
    // Same defensive read for parent2 (PR #184 review): the pin is that
    // parent2's epoch ADVANCES while parent1's does not change — not that no
    // earlier case ever touched parent2.
    const parent2Before = (
      await getDb().collection('users').doc(seed.parent2.uid).get()
    ).data()?.sessionEpoch as Timestamp | undefined;

    await callFunction('signOutEverywhere', {}, parent2Token);

    const parent2Doc = (await getDb().collection('users').doc(seed.parent2.uid).get()).data()!;
    expect(parent2Doc.sessionEpoch).toBeInstanceOf(Timestamp);
    expect((parent2Doc.sessionEpoch as Timestamp).toMillis()).toBeGreaterThan(
      parent2Before?.toMillis() ?? 0,
    );
    const parent1After = (
      await getDb().collection('users').doc(seed.parent1.uid).get()
    ).data()!.sessionEpoch as Timestamp | undefined;
    expect(parent1After?.toMillis() ?? null).toBe(parent1Before?.toMillis() ?? null);
  });

  it('succeeds as a no-op for an auth user without a users doc (no ghost doc)', async () => {
    // getIdToken mints via a custom token, which materializes an auth user in
    // the emulator without any users doc — exactly the ghost-doc hazard path.
    const ghostUid = 'ghost-no-users-doc';
    const ghostToken = await getIdToken(ghostUid);

    const res = await callFunction<{ ok: boolean }>('signOutEverywhere', {}, ghostToken);
    expect(res).toEqual({ ok: true });

    // No partial users doc was created...
    const ghostDoc = await getDb().collection('users').doc(ghostUid).get();
    expect(ghostDoc.exists).toBe(false);
    // ...while revocation and the audit entry still landed.
    const ghostUser = await getAdminAuth().getUser(ghostUid);
    expect(ghostUser.tokensValidAfterTime).toBeTruthy();
    expect(await auditCount(ghostUid)).toBe(1);
  });
});
