import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Silent existing-account flow (issue #148): any signup verification request
// for an email that belongs to a DIFFERENT account must be indistinguishable
// from a fresh signup — same response body, a DECOY verificationCodes doc
// byte-shaped like the fresh path's (so every downstream step errors
// identically), and an account-exists email to the mailbox owner instead of a
// working code (rate-limited via accountExistsNotices). The only exception is
// the authed own-email bypass (cross-app add-profile), which issues a real
// code. Each test uses its own seeded email to avoid order coupling on the
// shared cooldown/marker state.

const FRESH_RESPONSE = { success: true, message: 'Verification code sent' };
// Decoy and real codes are crypto.randomInt(100000, 999999) — '000000' can
// never match either, so it is a guaranteed-wrong probe on both paths.
const WRONG_CODE = '000000';

async function captureError(fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await fn();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? '', message: err.message ?? '' };
  }
  throw new Error('expected the call to reject');
}

describe('verifyEjmEmail cross-app and silent existing-account cases', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    // Preapprove the seeded EJM-format emails so domain validation is skipped
    // (seed emails carry no graduation-year digits).
    const db = getDb();
    for (const email of [
      seed.babysitter1.email, // authed own-email bypass
      seed.babysitter2.email, // authed someone-else silent path
      seed.babysitter3.email, // silent-path cooldown
      seed.tutor1.email, // 24h mail-bomb guard
      seed.tutor2.email, // forged app param
      seed.tutor3.email, // verifyCode oracle parity
    ]) {
      await db.collection('preapprovedEmails').doc(email.toLowerCase()).set({ used: false });
    }
  });

  afterAll(async () => {
    await clearAll();
  });

  it('authenticated user can request a code for their own account email (bypass keeps issuing a real code)', async () => {
    const token = await getIdToken(seed.babysitter1.uid);
    const result = await callFunction<{ success: boolean }>(
      'verifyEjmEmail',
      { email: seed.babysitter1.email },
      token,
    );
    expect(result.success).toBe(true);

    const codeDoc = await getDb()
      .collection('verificationCodes')
      .doc(seed.babysitter1.email.toLowerCase())
      .get();
    expect(codeDoc.exists).toBe(true);
  });

  it("authenticated request for someone else's account email: silent success, fresh-shaped decoy doc, notice written", async () => {
    const email = seed.babysitter2.email.toLowerCase();
    const token = await getIdToken(seed.parent1.uid);
    const result = await callFunction('verifyEjmEmail', { email: seed.babysitter2.email }, token);
    expect(result).toEqual(FRESH_RESPONSE);

    // The decoy doc is byte-shaped like the fresh path's write: same fields,
    // unguessable 6-digit code, preapproved emails carry graduationYear null.
    const codeDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(codeDoc.exists).toBe(true);
    const data = codeDoc.data()!;
    expect(data.code).toMatch(/^\d{6}$/);
    expect(data.email).toBe(email);
    expect(data.graduationYear).toBeNull();
    expect(data.attempts).toBe(0);
    expect(data.expiresAt).toBeTruthy();
    expect(data.createdAt).toBeTruthy();

    const notice = await getDb().collection('accountExistsNotices').doc(email).get();
    expect(notice.exists).toBe(true);
    expect(notice.data()!.lastSentAt).toBeTruthy();
  });

  it('the account-exists email is audit-logged', async () => {
    const entries = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'account_exists_email_sent')
      .get();
    expect(entries.size).toBeGreaterThanOrEqual(1);
    const details = entries.docs.map((d) => d.data().details?.email);
    expect(details).toContain(seed.babysitter2.email.toLowerCase());
  });

  it('a second request after the cooldown but within 24h still succeeds without resending (mail-bomb guard)', async () => {
    const email = seed.tutor1.email.toLowerCase();
    const first = await callFunction('verifyEjmEmail', { email: seed.tutor1.email });
    expect(first).toEqual(FRESH_RESPONSE);

    const before = await getDb().collection('accountExistsNotices').doc(email).get();
    expect(before.exists).toBe(true);
    const beforeMs = before.data()!.lastSentAt.toMillis();
    const auditBefore = (
      await getDb().collection('auditLogs').where('action', '==', 'account_exists_email_sent').get()
    ).size;

    // Remove the decoy so the repeat bypasses the 60s send cooldown and
    // exercises the 24h notice guard itself (the cooldown has its own pin).
    await getDb().collection('verificationCodes').doc(email).delete();

    const result = await callFunction('verifyEjmEmail', { email: seed.tutor1.email });
    expect(result).toEqual(FRESH_RESPONSE);

    const after = await getDb().collection('accountExistsNotices').doc(email).get();
    expect(after.data()!.lastSentAt.toMillis()).toBe(beforeMs);
    // No second email means no second audit entry either.
    const auditAfter = (
      await getDb().collection('auditLogs').where('action', '==', 'account_exists_email_sent').get()
    ).size;
    expect(auditAfter).toBe(auditBefore);

    // The decoy was re-written (a fresh email would also get a new code doc).
    const codeDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(codeDoc.exists).toBe(true);
  });

  it('a silent-path repeat within the 60s cooldown returns the fresh body and leaves the decoy untouched', async () => {
    const email = seed.babysitter3.email.toLowerCase();
    const first = await callFunction('verifyEjmEmail', { email: seed.babysitter3.email });
    expect(first).toEqual(FRESH_RESPONSE);
    const decoyBefore = (await getDb().collection('verificationCodes').doc(email).get()).data()!;

    const second = await callFunction('verifyEjmEmail', { email: seed.babysitter3.email });
    expect(second).toEqual(FRESH_RESPONSE);

    const decoyAfter = (await getDb().collection('verificationCodes').doc(email).get()).data()!;
    expect(decoyAfter.code).toBe(decoyBefore.code);
    expect(decoyAfter.createdAt.toMillis()).toBe(decoyBefore.createdAt.toMillis());
  });

  it('a forged app param traverses the real silent path: notice + decoy written, response unchanged', async () => {
    const email = seed.tutor2.email.toLowerCase();
    // No prior marker for this address — the send branch actually runs and
    // the forged value passes through normalizeAccountExistsApp.
    const priorNotice = await getDb().collection('accountExistsNotices').doc(email).get();
    expect(priorNotice.exists).toBe(false);

    const result = await callFunction('verifyEjmEmail', {
      email: seed.tutor2.email,
      app: '<script>alert(1)</script>',
    });
    expect(result).toEqual(FRESH_RESPONSE);

    const notice = await getDb().collection('accountExistsNotices').doc(email).get();
    expect(notice.exists).toBe(true);
    const codeDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(codeDoc.exists).toBe(true);
  });

  it('unauthenticated verifyParentEmail for an existing email: silent success, parent-shaped decoy, notice written', async () => {
    const email = seed.parent1.email.toLowerCase();
    const result = await callFunction('verifyParentEmail', { email: seed.parent1.email, app: 'sit' });
    expect(result).toEqual(FRESH_RESPONSE);

    const codeDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(codeDoc.exists).toBe(true);
    const data = codeDoc.data()!;
    expect(data.code).toMatch(/^\d{6}$/);
    // verifyParentEmail's fresh path writes no graduationYear — neither does
    // its decoy (shape owned by the callable).
    expect('graduationYear' in data).toBe(false);

    const notice = await getDb().collection('accountExistsNotices').doc(email).get();
    expect(notice.exists).toBe(true);
  });
});

describe('post-silent-success oracle parity (issue #148 round 2)', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    await getDb()
      .collection('preapprovedEmails')
      .doc(seed.tutor3.email.toLowerCase())
      .set({ used: false });
  });

  afterAll(async () => {
    await clearAll();
  });

  it('verifyCode with a wrong code errors identically after silent-verify (existing) and fresh-verify, through the attempts limit', async () => {
    const freshEmail = 'fresh28@ejm.org'; // EJM-valid, no account
    const silentEmail = seed.tutor3.email; // existing account -> decoy doc

    await callFunction('verifyEjmEmail', { email: freshEmail });
    await callFunction('verifyEjmEmail', { email: silentEmail });

    // Wrong-code probe: byte-identical error on both paths.
    const freshErr = await captureError(() =>
      callFunction('verifyCode', { email: freshEmail, code: WRONG_CODE }),
    );
    const silentErr = await captureError(() =>
      callFunction('verifyCode', { email: silentEmail, code: WRONG_CODE }),
    );
    expect(freshErr).toEqual({ code: 'INVALID_ARGUMENT', message: 'Invalid verification code' });
    expect(silentErr).toEqual(freshErr);

    // Exhaust the attempts limit on both (first probe already counted once):
    // the too-many-attempts behavior must match too.
    for (let i = 0; i < 4; i++) {
      await captureError(() => callFunction('verifyCode', { email: freshEmail, code: WRONG_CODE }));
      await captureError(() => callFunction('verifyCode', { email: silentEmail, code: WRONG_CODE }));
    }
    const freshExhausted = await captureError(() =>
      callFunction('verifyCode', { email: freshEmail, code: WRONG_CODE }),
    );
    const silentExhausted = await captureError(() =>
      callFunction('verifyCode', { email: silentEmail, code: WRONG_CODE }),
    );
    expect(freshExhausted).toEqual({
      code: 'RESOURCE_EXHAUSTED',
      message: 'Too many failed attempts. Please request a new verification code.',
    });
    expect(silentExhausted).toEqual(freshExhausted);
  });

  it('joinFamily (no verifyCode hop) with a wrong code errors identically after silent-verify and fresh-verify', async () => {
    const db = getDb();
    const seedInvite = (token: string) =>
      db.collection('inviteLinks').doc(token).set({
        token,
        familyId: 'oracle-family',
        familyName: 'OracleTest',
        createdByUserId: 'some-parent',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        used: false,
        createdAt: new Date(),
      });
    await seedInvite('oracle-fresh');
    await seedInvite('oracle-silent');

    const freshEmail = 'newjoin@test.com'; // no account
    const silentEmail = seed.parent2.email; // existing account -> decoy doc
    await callFunction('verifyParentEmail', { email: freshEmail });
    await callFunction('verifyParentEmail', { email: silentEmail });

    const joinPayload = (token: string, email: string) => ({
      token,
      email,
      verificationCode: WRONG_CODE,
      password: 'Str0ngPass1',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const freshErr = await captureError(() =>
      callFunction('joinFamily', joinPayload('oracle-fresh', freshEmail)),
    );
    const silentErr = await captureError(() =>
      callFunction('joinFamily', joinPayload('oracle-silent', silentEmail)),
    );
    expect(freshErr).toEqual({ code: 'INVALID_ARGUMENT', message: 'Invalid verification code' });
    expect(silentErr).toEqual(freshErr);
  });
});
