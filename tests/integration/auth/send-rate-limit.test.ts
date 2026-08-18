import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getAdminAuth, getIdToken } from '../../setup/emulator.js';

// Issue #155: send-volume caps for the signup verification callables.
//
// - Per-ADDRESS daily cap (10/24h, verifyEjmEmail + verifyParentEmail
//   combined, one counter doc per normalized address): trips SILENTLY — the
//   response body stays byte-identical to the fresh success and nothing is
//   written or refreshed (no code doc, no decoy, no notice, no counter bump).
//   Any error would be a new abuse/enumeration oracle (#148/#154 ledger).
// - Per-UID bypass allowance (6/hour) for the authed own-email bypass: throws
//   an explicit failed-precondition — the caller is authenticated and
//   self-directed, so the anti-oracle constraint does not apply.
//
// Technique: counters are seeded/bumped directly via the admin SDK (the
// collection is server-only, but the admin SDK bypasses rules) instead of
// looping 10 real sends — each test manufactures the exact pre-state it pins.

const FRESH_RESPONSE = { success: true, message: 'Verification code sent' };
const COUNTERS = 'verificationSendCounters';
const HOUR_MS = 60 * 60 * 1000;

function seedCounter(id: string, kind: 'address' | 'bypass', count: number, ageMs: number) {
  return getDb()
    .collection(COUNTERS)
    .doc(id)
    .set({ key: id, kind, count, windowStart: new Date(Date.now() - ageMs) });
}

async function createAccount(email: string) {
  const { uid } = await getAdminAuth().createUser({ email, password: 'Test1234' });
  await getDb().collection('users').doc(uid).set({ uid, email, status: 'active' });
  return uid;
}

describe('per-address daily send cap (issue #155)', () => {
  beforeAll(async () => {
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
  });

  it('the 11th send in the window trips silently: byte-identical body, no code doc, no counter bump', async () => {
    const email = 'capfresh28@ejm.org';
    // Counter already at the cap (seeded — see the technique note above); no
    // code doc, so the 60s cooldown cannot be what short-circuits.
    await seedCounter(email, 'address', 10, HOUR_MS);

    const result = await callFunction('verifyEjmEmail', { email });
    expect(result).toEqual(FRESH_RESPONSE);

    // NO code doc was written — the capped path does no work at all...
    const codeDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(codeDoc.exists).toBe(false);
    // ...and no counter bump either (fixed window, not sliding lockout).
    const counter = (await getDb().collection(COUNTERS).doc(email).get()).data()!;
    expect(counter.count).toBe(10);
  });

  it('an under-cap send is unaffected: code doc written, counter incremented, window anchor preserved', async () => {
    const email = 'undercap28@ejm.org';
    await seedCounter(email, 'address', 9, HOUR_MS);
    const anchorBefore = (await getDb().collection(COUNTERS).doc(email).get())
      .data()!
      .windowStart.toMillis();

    const result = await callFunction('verifyEjmEmail', { email });
    expect(result).toEqual(FRESH_RESPONSE);

    const codeDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(codeDoc.exists).toBe(true);
    expect(codeDoc.data()!.code).toMatch(/^\d{6}$/);

    const counter = (await getDb().collection(COUNTERS).doc(email).get()).data()!;
    expect(counter.count).toBe(10);
    expect(counter.windowStart.toMillis()).toBe(anchorBefore);
  });

  it('the 60s cooldown composes BEFORE the cap: an in-cooldown repeat consumes no budget', async () => {
    const email = 'compose28@ejm.org';
    // A real first send: writes the code doc (cooldown live) and count 1.
    await callFunction('verifyEjmEmail', { email });
    const counterBefore = (await getDb().collection(COUNTERS).doc(email).get()).data()!;
    expect(counterBefore.count).toBe(1);

    // Repeat within 60s: fresh body via the cooldown short-circuit, and the
    // counter is UNTOUCHED — proof the cooldown runs first (the cap
    // registration would have bumped it to 2).
    const repeat = await callFunction('verifyEjmEmail', { email });
    expect(repeat).toEqual(FRESH_RESPONSE);
    const counterAfter = (await getDb().collection(COUNTERS).doc(email).get()).data()!;
    expect(counterAfter.count).toBe(1);
    expect(counterAfter.windowStart.toMillis()).toBe(counterBefore.windowStart.toMillis());
  });

  it('the silent existing-account path is capped identically: no decoy, no notice, same body', async () => {
    const email = 'capsilent28@ejm.org';
    await createAccount(email);
    await seedCounter(email, 'address', 10, HOUR_MS);

    const probe = await callFunction('verifyEjmEmail', { email });
    expect(probe).toEqual(FRESH_RESPONSE);

    // Nothing was written on the silent branch either: no decoy code doc,
    // no account-exists machinery (the mailbox owner gets no more mail).
    expect((await getDb().collection('verificationCodes').doc(email).get()).exists).toBe(false);
    expect((await getDb().collection('accountExistsNotices').doc(email).get()).exists).toBe(false);
  });

  it('an unauthenticated silent-path probe consumes budget symmetrically with the fresh path', async () => {
    const email = 'silentbudget28@ejm.org';
    await createAccount(email);

    await callFunction('verifyEjmEmail', { email });

    const counter = (await getDb().collection(COUNTERS).doc(email).get()).data()!;
    expect(counter.kind).toBe('address');
    expect(counter.count).toBe(1);
  });

  it('the budget is SHARED across verifyEjmEmail and verifyParentEmail (one counter per address)', async () => {
    const email = 'combined28@ejm.org';
    // A real verifyEjmEmail send opens the shared window...
    await callFunction('verifyEjmEmail', { email });
    const codeBefore = (await getDb().collection('verificationCodes').doc(email).get()).data()!;
    // ...bump the SAME counter doc to the cap and clear the cooldown (admin
    // SDK backdate) so only the cap can stop the next call.
    await getDb().collection(COUNTERS).doc(email).update({ count: 10 });
    await getDb()
      .collection('verificationCodes')
      .doc(email)
      .update({ createdAt: new Date(Date.now() - 120 * 1000) });
    const backdatedCreatedAt = (
      await getDb().collection('verificationCodes').doc(email).get()
    ).data()!.createdAt.toMillis();

    // verifyParentEmail on the same address (any-domain callable, study
    // wizard path) trips the shared cap: fresh body, existing code doc NOT
    // refreshed, counter not bumped.
    const result = await callFunction('verifyParentEmail', { email });
    expect(result).toEqual(FRESH_RESPONSE);
    const codeAfter = (await getDb().collection('verificationCodes').doc(email).get()).data()!;
    expect(codeAfter.code).toBe(codeBefore.code);
    expect(codeAfter.createdAt.toMillis()).toBe(backdatedCreatedAt);
    const counter = (await getDb().collection(COUNTERS).doc(email).get()).data()!;
    expect(counter.count).toBe(10);
  });

  it('verifyParentEmail alone is capped too (fresh non-EJM address, study wizard path)', async () => {
    const email = 'cappedparent@test.com';
    await seedCounter(email, 'address', 10, HOUR_MS);

    const result = await callFunction('verifyParentEmail', { email });
    expect(result).toEqual(FRESH_RESPONSE);
    expect((await getDb().collection('verificationCodes').doc(email).get()).exists).toBe(false);
  });

  it('the cap frees up once the 24h window elapses: counter resets to a fresh window', async () => {
    const email = 'windowreset28@ejm.org';
    await seedCounter(email, 'address', 10, 25 * HOUR_MS);

    const result = await callFunction('verifyEjmEmail', { email });
    expect(result).toEqual(FRESH_RESPONSE);
    expect((await getDb().collection('verificationCodes').doc(email).get()).exists).toBe(true);
    const counter = (await getDb().collection(COUNTERS).doc(email).get()).data()!;
    expect(counter.count).toBe(1);
    expect(Date.now() - counter.windowStart.toMillis()).toBeLessThan(60 * 1000);
  });
});

describe('authed own-email bypass allowance (issue #155, #154 residual)', () => {
  beforeAll(async () => {
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
  });

  it('the 7th bypass send within the hour throws failed-precondition with a clear message', async () => {
    const email = 'bypasscap28@ejm.org';
    const uid = await createAccount(email);
    const token = await getIdToken(uid);
    // Allowance already spent (seeded per-uid counter — see technique note).
    await seedCounter(uid, 'bypass', 6, 10 * 60 * 1000);

    let caught: { code?: string; message?: string; details?: unknown } | undefined;
    try {
      await callFunction('verifyEjmEmail', { email }, token);
    } catch (e) {
      caught = e as { code?: string; message?: string; details?: unknown };
    }
    expect(caught?.code).toBe('FAILED_PRECONDITION');
    expect(caught?.message).toBe(
      'Too many verification emails requested for this account. Please wait up to an hour and try again.'
    );
    // PR #180 round 2: the machine-readable marker the clients map to
    // translated copy rides the error's details.
    expect(caught?.details).toEqual({ reason: 'send-cap' });

    // The capped bypass wrote nothing: no code doc, no counter bump.
    expect((await getDb().collection('verificationCodes').doc(email).get()).exists).toBe(false);
    expect((await getDb().collection(COUNTERS).doc(uid).get()).data()!.count).toBe(6);
  });

  it('an under-allowance bypass send still issues a real code and bumps the uid counter', async () => {
    const email = 'bypassok28@ejm.org';
    const uid = await createAccount(email);
    const token = await getIdToken(uid);
    await seedCounter(uid, 'bypass', 5, 10 * 60 * 1000);

    const result = await callFunction('verifyEjmEmail', { email }, token);
    expect(result).toEqual(FRESH_RESPONSE);

    const codeDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(codeDoc.exists).toBe(true);
    expect(codeDoc.data()!.decoy).toBeUndefined();
    const counter = (await getDb().collection(COUNTERS).doc(uid).get()).data()!;
    expect(counter.kind).toBe('bypass');
    expect(counter.count).toBe(6);
  });

  it('the allowance resets after the hour: a spent counter with an elapsed window sends again', async () => {
    const email = 'bypassreset28@ejm.org';
    const uid = await createAccount(email);
    const token = await getIdToken(uid);
    await seedCounter(uid, 'bypass', 6, 61 * 60 * 1000);

    const result = await callFunction('verifyEjmEmail', { email }, token);
    expect(result).toEqual(FRESH_RESPONSE);
    expect((await getDb().collection('verificationCodes').doc(email).get()).exists).toBe(true);
    expect((await getDb().collection(COUNTERS).doc(uid).get()).data()!.count).toBe(1);
  });

  it('the bypass is EXEMPT from the per-address cap (a prober cannot starve the owner) and spends no address budget', async () => {
    const email = 'bypassexempt28@ejm.org';
    const uid = await createAccount(email);
    const token = await getIdToken(uid);
    // A prober burned the whole address budget...
    await seedCounter(email, 'address', 10, HOUR_MS);

    // ...but the owner's own send still issues a REAL code (the same
    // starvation rationale as the bypass's cooldown exemption, #154)...
    const result = await callFunction('verifyEjmEmail', { email }, token);
    expect(result).toEqual(FRESH_RESPONSE);
    const codeDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(codeDoc.exists).toBe(true);
    expect(codeDoc.data()!.decoy).toBeUndefined();

    // ...tracked only against the uid allowance, never the address counter.
    expect((await getDb().collection(COUNTERS).doc(email).get()).data()!.count).toBe(10);
    expect((await getDb().collection(COUNTERS).doc(uid).get()).data()!.count).toBe(1);
  });
});
