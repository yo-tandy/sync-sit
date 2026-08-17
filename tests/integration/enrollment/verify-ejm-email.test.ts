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
      seed.babysitter4.email, // no-clobber guard
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

    // Bypass purity: the own-email flow is a legitimate resend, not a signup
    // probe — it must not trip the account-exists machinery.
    const notice = await getDb()
      .collection('accountExistsNotices')
      .doc(seed.babysitter1.email.toLowerCase())
      .get();
    expect(notice.exists).toBe(false);
  });

  it('an unauthenticated probe cannot destroy a live bypass code (no-clobber guard, round 3)', async () => {
    const email = seed.babysitter4.email.toLowerCase();
    // 1. The authed own-email bypass writes a REAL code.
    const token = await getIdToken(seed.babysitter4.uid);
    await callFunction('verifyEjmEmail', { email: seed.babysitter4.email }, token);
    const codeRef = getDb().collection('verificationCodes').doc(email);
    const realCode = (await codeRef.get()).data()!.code as string;

    // 2. Backdate createdAt past the 60s cooldown (admin SDK) — otherwise the
    // probe short-circuits there and never reaches the silent path at all.
    // Seed attempts=3 to pin the anti-brute-force property below.
    await codeRef.update({ createdAt: new Date(Date.now() - 120 * 1000), attempts: 3 });
    const expiresBefore = (await codeRef.get()).data()!.expiresAt.toMillis();

    // 3. Unauthenticated probe on the same address: fresh body...
    const probe = await callFunction('verifyEjmEmail', { email: seed.babysitter4.email });
    expect(probe).toEqual(FRESH_RESPONSE);

    // ...the REAL code survives with attempts and expiry FROZEN (round 4:
    // resetting attempts would grant a prober 5 fresh guesses per cooldown
    // cycle at the victim's live code; refreshing expiresAt would keep it
    // alive indefinitely)...
    const afterProbe = (await codeRef.get()).data()!;
    expect(afterProbe.code).toBe(realCode);
    expect(afterProbe.attempts).toBe(3);
    expect(afterProbe.expiresAt.toMillis()).toBe(expiresBefore);

    // ...and it still verifies (the victim's flow works)...
    const verified = await callFunction<{ valid: boolean }>('verifyCode', {
      email,
      code: realCode,
    });
    expect(verified.valid).toBe(true);

    // ...and the silent path itself still fired (notice marker written).
    const notice = await getDb().collection('accountExistsNotices').doc(email).get();
    expect(notice.exists).toBe(true);
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
    // Self-sufficient: own seeded user + own triggering call (no coupling to
    // the other tests' side effects).
    const { getAdminAuth } = await import('../../setup/emulator.js');
    const email = 'audit.target28@ejm.org';
    const { uid } = await getAdminAuth().createUser({ email });
    await getDb().collection('users').doc(uid).set({ uid, email, status: 'active' });

    await callFunction('verifyEjmEmail', { email });

    const entries = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'account_exists_email_sent')
      .get();
    const details = entries.docs.map((d) => d.data().details?.email);
    expect(details).toContain(email);
  });

  it('the authed own-email bypass issues a real code immediately after an unauthenticated probe (cooldown exempt)', async () => {
    // Reviewer repro (round 4): an attacker polling a known address keeps the
    // doc's createdAt permanently fresh; the victim's own "send code" for the
    // cross-app add-profile flow must NOT be starved by that cooldown.
    const { getAdminAuth } = await import('../../setup/emulator.js');
    const email = 'probe.victim28@ejm.org';
    const { uid } = await getAdminAuth().createUser({ email });
    await getDb().collection('users').doc(uid).set({ uid, email, status: 'active' });

    // 1. Unauthenticated probe: silent path writes a fresh decoy (createdAt now).
    const probe = await callFunction('verifyEjmEmail', { email });
    expect(probe).toEqual(FRESH_RESPONSE);
    const decoy = (await getDb().collection('verificationCodes').doc(email).get()).data()!;
    expect(decoy.decoy).toBe(true);

    // 2. WITHIN the 60s window, the victim (authed, own email) clicks send:
    // a REAL code must be issued — the bypass skips the cooldown.
    const token = await getIdToken(uid);
    const result = await callFunction('verifyEjmEmail', { email }, token);
    expect(result).toEqual(FRESH_RESPONSE);

    const doc = (await getDb().collection('verificationCodes').doc(email).get()).data()!;
    expect(doc.decoy).toBeUndefined();
    expect(doc.code).toMatch(/^\d{6}$/);
    expect(doc.code).not.toBe(decoy.code);

    // 3. And that real code verifies — the victim completes their flow.
    const verified = await callFunction<{ valid: boolean }>('verifyCode', {
      email,
      code: doc.code,
    });
    expect(verified.valid).toBe(true);
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

  it('a whitespace-padded EXISTING address still takes the silent path, keyed on the trimmed id (round 6)', async () => {
    // Round-6 blocking fix: without trimming, "victim28@ejm.org " missed the
    // exact-match users query and routed an existing account down the FRESH
    // branch (real code emailed, no account-exists notice, per-variant
    // cooldown slots).
    const { getAdminAuth } = await import('../../setup/emulator.js');
    const email = 'trim.victim28@ejm.org';
    const padded = `${email} `;
    const { uid } = await getAdminAuth().createUser({ email });
    await getDb().collection('users').doc(uid).set({ uid, email, status: 'active' });

    const result = await callFunction('verifyEjmEmail', { email: padded });
    expect(result).toEqual(FRESH_RESPONSE);

    // Decoy under the TRIMMED id, nothing under the padded id.
    const trimmedDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(trimmedDoc.exists).toBe(true);
    expect(trimmedDoc.data()!.decoy).toBe(true);
    const paddedDoc = await getDb().collection('verificationCodes').doc(padded).get();
    expect(paddedDoc.exists).toBe(false);

    // The account-exists machinery fired for the trimmed address.
    const notice = await getDb().collection('accountExistsNotices').doc(email).get();
    expect(notice.exists).toBe(true);
  });

  it('a whitespace-padded FRESH address writes its code under the trimmed id and shares one cooldown slot (round 6)', async () => {
    const email = 'trimfresh28@ejm.org';
    const result = await callFunction('verifyEjmEmail', { email: `${email} ` });
    expect(result).toEqual(FRESH_RESPONSE);

    const trimmedDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(trimmedDoc.exists).toBe(true);
    expect(trimmedDoc.data()!.decoy).toBeUndefined();
    const code = trimmedDoc.data()!.code;
    expect(
      (await getDb().collection('verificationCodes').doc(`${email} `).get()).exists,
    ).toBe(false);

    // A differently-padded repeat hits the SAME cooldown slot: success body,
    // doc untouched (padding can no longer multiply rate-limit slots).
    const repeat = await callFunction('verifyEjmEmail', { email: `  ${email}` });
    expect(repeat).toEqual(FRESH_RESPONSE);
    const after = await getDb().collection('verificationCodes').doc(email).get();
    expect(after.data()!.code).toBe(code);
  });

  it('verifyParentEmail repeats within the 60s cooldown return the fresh body without rewriting (fresh and silent paths)', async () => {
    const db = getDb();
    // Fresh path: brand-new email.
    const freshEmail = 'cooldownparent@test.com';
    await callFunction('verifyParentEmail', { email: freshEmail });
    const freshBefore = (await db.collection('verificationCodes').doc(freshEmail).get()).data()!;
    const freshRepeat = await callFunction('verifyParentEmail', { email: freshEmail });
    expect(freshRepeat).toEqual(FRESH_RESPONSE);
    const freshAfter = (await db.collection('verificationCodes').doc(freshEmail).get()).data()!;
    expect(freshAfter.code).toBe(freshBefore.code);
    expect(freshAfter.createdAt.toMillis()).toBe(freshBefore.createdAt.toMillis());

    // Silent path: existing parent account (decoy doc).
    const silentEmail = seed.parent3.email.toLowerCase();
    await callFunction('verifyParentEmail', { email: seed.parent3.email });
    const silentBefore = (await db.collection('verificationCodes').doc(silentEmail).get()).data()!;
    const silentRepeat = await callFunction('verifyParentEmail', { email: seed.parent3.email });
    expect(silentRepeat).toEqual(FRESH_RESPONSE);
    const silentAfter = (await db.collection('verificationCodes').doc(silentEmail).get()).data()!;
    expect(silentAfter.code).toBe(silentBefore.code);
    expect(silentAfter.createdAt.toMillis()).toBe(silentBefore.createdAt.toMillis());
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

    // Cross-request boundary (round 4): re-request past the 60s cooldown —
    // the rewrite must reset attempts identically on both paths, or the
    // frozen state becomes a deterministic oracle (RESOURCE_EXHAUSTED vs
    // INVALID_ARGUMENT on the very next probe).
    const db = getDb();
    const backdateCreatedAt = (email: string) =>
      db
        .collection('verificationCodes')
        .doc(email.toLowerCase())
        .update({ createdAt: new Date(Date.now() - 120 * 1000) });
    await backdateCreatedAt(freshEmail);
    await backdateCreatedAt(silentEmail);
    await callFunction('verifyEjmEmail', { email: freshEmail });
    await callFunction('verifyEjmEmail', { email: silentEmail });

    const freshAfterRerequest = await captureError(() =>
      callFunction('verifyCode', { email: freshEmail, code: WRONG_CODE }),
    );
    const silentAfterRerequest = await captureError(() =>
      callFunction('verifyCode', { email: silentEmail, code: WRONG_CODE }),
    );
    expect(freshAfterRerequest).toEqual({
      code: 'INVALID_ARGUMENT',
      message: 'Invalid verification code',
    });
    expect(silentAfterRerequest).toEqual(freshAfterRerequest);

    // expiresAt variant: the re-request refreshed expiry on BOTH paths, so a
    // probe after the ORIGINAL 10-minute window cannot split into
    // INVALID_ARGUMENT vs DEADLINE_EXCEEDED. Pinned via the rewritten docs'
    // expiry timestamps (both pushed well past the original window).
    const freshDoc = (await db.collection('verificationCodes').doc(freshEmail).get()).data()!;
    const silentDoc = (
      await db.collection('verificationCodes').doc(silentEmail.toLowerCase()).get()
    ).data()!;
    const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
    expect(freshDoc.expiresAt.toMillis()).toBeGreaterThan(fiveMinFromNow);
    expect(silentDoc.expiresAt.toMillis()).toBeGreaterThan(fiveMinFromNow);
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
