import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Silent existing-account flow (issue #148): any signup verification request
// for an email that belongs to a DIFFERENT account must be indistinguishable
// from a fresh signup on the wire — same response body, no thrown error — while
// never issuing a code and instead notifying the mailbox owner by email
// (rate-limited via accountExistsNotices). The only exception is the authed
// own-email bypass (cross-app add-profile), which still issues a real code.

const FRESH_RESPONSE = { success: true, message: 'Verification code sent' };

describe('verifyEjmEmail cross-app and silent existing-account cases', () => {
  let seed: SeedData;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    // Preapprove the babysitter's email so EJM domain validation is skipped
    // (test emails are not on the EJM domain).
    const db = getDb();
    await db
      .collection('preapprovedEmails')
      .doc(seed.babysitter1.email.toLowerCase())
      .set({ used: false });
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

  it("authenticated request for someone else's account email: silent success, no code doc, notice written", async () => {
    const email = seed.babysitter1.email.toLowerCase();
    // The bypass test above legitimately wrote a code doc for this email —
    // remove it so this test can prove the silent path writes none.
    await getDb().collection('verificationCodes').doc(email).delete();

    const token = await getIdToken(seed.parent1.uid);
    const result = await callFunction('verifyEjmEmail', { email: seed.babysitter1.email }, token);
    expect(result).toEqual(FRESH_RESPONSE);

    const codeDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(codeDoc.exists).toBe(false);

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
    expect(details).toContain(seed.babysitter1.email.toLowerCase());
  });

  it('a second request within 24h still succeeds but does not resend (lastSentAt unchanged, mail-bomb guard)', async () => {
    const email = seed.babysitter1.email.toLowerCase();
    const before = await getDb().collection('accountExistsNotices').doc(email).get();
    expect(before.exists).toBe(true);
    const beforeMs = before.data()!.lastSentAt.toMillis();
    const auditBefore = (
      await getDb().collection('auditLogs').where('action', '==', 'account_exists_email_sent').get()
    ).size;

    const result = await callFunction('verifyEjmEmail', { email: seed.babysitter1.email });
    expect(result).toEqual(FRESH_RESPONSE);

    const after = await getDb().collection('accountExistsNotices').doc(email).get();
    expect(after.data()!.lastSentAt.toMillis()).toBe(beforeMs);
    // No second email means no second audit entry either.
    const auditAfter = (
      await getDb().collection('auditLogs').where('action', '==', 'account_exists_email_sent').get()
    ).size;
    expect(auditAfter).toBe(auditBefore);

    // Still no code doc after the repeat call.
    const codeDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(codeDoc.exists).toBe(false);
  });

  it("an unknown/forged `app` param is accepted silently (normalized server-side, response unchanged)", async () => {
    const result = await callFunction('verifyEjmEmail', {
      email: seed.babysitter1.email,
      app: '<script>alert(1)</script>',
    });
    expect(result).toEqual(FRESH_RESPONSE);
  });

  it('unauthenticated verifyParentEmail for an existing email: silent success, no code doc, notice written', async () => {
    const email = seed.parent1.email.toLowerCase();
    const result = await callFunction('verifyParentEmail', { email: seed.parent1.email, app: 'sit' });
    expect(result).toEqual(FRESH_RESPONSE);

    const codeDoc = await getDb().collection('verificationCodes').doc(email).get();
    expect(codeDoc.exists).toBe(false);

    const notice = await getDb().collection('accountExistsNotices').doc(email).get();
    expect(notice.exists).toBe(true);
  });
});
