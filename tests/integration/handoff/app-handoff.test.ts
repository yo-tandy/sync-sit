import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// createAppHandoffCode / redeemAppHandoffCode: one-time 60s cross-app session
// handoff. The code is an unauthenticated capability — every way it can be bad
// (unknown, expired, already used, blocked user) fails with ONE byte-identical
// generic error, and redemption consumes the doc in a transaction (DELETE).

const AUTH_URL = `http://127.0.0.1:${process.env.TEST_AUTH_PORT ?? '9099'}`;

/** The client-side contract: the returned custom token signs in via the SDK path. */
async function signInWithCustomToken(token: string) {
  const res = await fetch(
    `${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, returnSecureToken: true }),
    },
  );
  return res.json();
}

/** uid claim of an emulator-issued ID token (unsigned JWT). */
function uidOfIdToken(idToken: string): string {
  const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
  return payload.user_id;
}

const GENERIC = {
  code: 'NOT_FOUND',
  details: { code: 'handoff/invalid-code' },
};

describe('app handoff (createAppHandoffCode / redeemAppHandoffCode)', () => {
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

  async function mint(authToken: string): Promise<string> {
    const res = await callFunction<{ code: string }>('createAppHandoffCode', {}, authToken);
    return res.code;
  }

  it('mint → redeem roundtrip yields a custom token that signs in as the minter', async () => {
    const code = await mint(parent1Token);
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThanOrEqual(32);

    const { token } = await callFunction<{ token: string }>('redeemAppHandoffCode', { code });
    expect(token).toBeTruthy();

    const signIn = await signInWithCustomToken(token);
    expect(signIn.idToken).toBeTruthy();
    expect(uidOfIdToken(signIn.idToken)).toBe(seed.parent1.uid);
  });

  it('stores only a hash (never the raw code) and deletes the doc on redemption', async () => {
    const code = await mint(parent1Token);

    const before = await getDb().collection('appHandoffCodes').get();
    expect(before.size).toBe(1);
    const doc = before.docs[0].data();
    expect(doc.uid).toBe(seed.parent1.uid);
    expect(doc.tokenHash).toBeTruthy();
    expect(doc.tokenHash).not.toBe(code);
    expect(JSON.stringify(doc)).not.toContain(code);
    expect(doc.expiresAt.toDate().getTime() - doc.createdAt.toDate().getTime()).toBe(60_000);

    await callFunction('redeemAppHandoffCode', { code });

    // Consume-by-DELETE: no stale row survives redemption.
    const after = await getDb().collection('appHandoffCodes').get();
    expect(after.size).toBe(0);
  });

  it('audits the mint without any token material', async () => {
    const code = await mint(parent1Token);
    const audits = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'app_handoff_created')
      .get();
    expect(audits.size).toBeGreaterThan(0);
    for (const a of audits.docs) {
      const json = JSON.stringify(a.data());
      expect(json).not.toContain(code);
    }
    await callFunction('redeemAppHandoffCode', { code }); // cleanup: consume
  });

  it('a code cannot be redeemed twice (one-time)', async () => {
    const code = await mint(parent1Token);
    await callFunction('redeemAppHandoffCode', { code });
    await expect(callFunction('redeemAppHandoffCode', { code })).rejects.toMatchObject(GENERIC);
  });

  it('an expired code fails generically AND is deleted (opportunistic hygiene)', async () => {
    const code = await mint(parent1Token);
    const snap = await getDb().collection('appHandoffCodes').get();
    expect(snap.size).toBe(1);
    await snap.docs[0].ref.update({ expiresAt: new Date(Date.now() - 1000) });

    await expect(callFunction('redeemAppHandoffCode', { code })).rejects.toMatchObject(GENERIC);

    const after = await getDb().collection('appHandoffCodes').get();
    expect(after.size).toBe(0);
  });

  it('unauthenticated mint is refused', async () => {
    await expect(callFunction('createAppHandoffCode', {})).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('a non-active user cannot mint', async () => {
    const uid = seed.babysitter1.uid;
    const token = await getIdToken(uid);
    await getDb().collection('users').doc(uid).update({ status: 'blocked' });
    try {
      await expect(callFunction('createAppHandoffCode', {}, token)).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      });
    } finally {
      await getDb().collection('users').doc(uid).update({ status: 'active' });
    }
  });

  it('a user blocked AFTER minting redeems into the same generic error', async () => {
    const uid = seed.babysitter1.uid;
    const token = await getIdToken(uid);
    const code = await mint(token);
    await getDb().collection('users').doc(uid).update({ status: 'blocked' });
    try {
      await expect(callFunction('redeemAppHandoffCode', { code })).rejects.toMatchObject(GENERIC);
    } finally {
      await getDb().collection('users').doc(uid).update({ status: 'active' });
    }
  });

  it('every failure mode shares ONE byte-identical error (no oracle)', async () => {
    const failures: Array<{ code: string; message: string; details: unknown }> = [];
    const capture = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        throw new Error('expected rejection');
      } catch (err) {
        const e = err as Error & { code: string; details?: unknown };
        failures.push({ code: e.code, message: e.message, details: e.details });
      }
    };

    // Garbage code (well-formed but unknown).
    await capture(() => callFunction('redeemAppHandoffCode', { code: 'garbage-code' }));
    // Malformed inputs (empty / oversized / wrong type).
    await capture(() => callFunction('redeemAppHandoffCode', { code: '' }));
    await capture(() => callFunction('redeemAppHandoffCode', { code: 'x'.repeat(129) }));
    await capture(() => callFunction('redeemAppHandoffCode', {}));
    // Expired.
    const expired = await mint(parent1Token);
    const snap = await getDb().collection('appHandoffCodes').get();
    await snap.docs[0].ref.update({ expiresAt: new Date(Date.now() - 1000) });
    await capture(() => callFunction('redeemAppHandoffCode', { code: expired }));
    // Already used.
    const used = await mint(parent1Token);
    await callFunction('redeemAppHandoffCode', { code: used });
    await capture(() => callFunction('redeemAppHandoffCode', { code: used }));

    expect(failures).toHaveLength(6);
    for (const f of failures.slice(1)) {
      expect(f).toEqual(failures[0]);
    }
    // The security pin: the user-visible MESSAGE is byte-identical everywhere.
    const messages = new Set(failures.map((f) => f.message));
    expect(messages.size).toBe(1);
  });
});
