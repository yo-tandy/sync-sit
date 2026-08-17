import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb } from '../../setup/emulator.js';

describe('verifyEjmEmail', () => {
  beforeAll(async () => {
    await clearAll();
  });

  afterAll(async () => {
    await clearAll();
  });

  it('sends verification code for valid EJM email', async () => {
    const result = await callFunction<{ success: boolean; message: string }>(
      'verifyEjmEmail',
      { email: 'student28@ejm.org' }
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('Verification code sent');

    // Verify code was stored in Firestore
    const db = getDb();
    const codeDoc = await db.collection('verificationCodes').doc('student28@ejm.org').get();
    expect(codeDoc.exists).toBe(true);
    const data = codeDoc.data()!;
    expect(data.code).toMatch(/^\d{6}$/);
  });

  it('rejects non-EJM email domain', async () => {
    await expect(
      callFunction('verifyEjmEmail', { email: 'user@gmail.com' })
    ).rejects.toThrow();
  });

  it('rejects missing email', async () => {
    await expect(
      callFunction('verifyEjmEmail', {})
    ).rejects.toThrow();
  });

  it('a repeat request within the 60s cooldown returns success without rewriting the code doc', async () => {
    // Self-sufficient: own email, two immediate calls.
    const db = getDb();
    const first = await callFunction<{ success: boolean; message: string }>(
      'verifyEjmEmail',
      { email: 'student29@ejm.org' }
    );
    expect(first.success).toBe(true);
    const before = (await db.collection('verificationCodes').doc('student29@ejm.org').get()).data()!;

    const second = await callFunction<{ success: boolean; message: string }>(
      'verifyEjmEmail',
      { email: 'student29@ejm.org' }
    );
    expect(second).toEqual({ success: true, message: 'Verification code sent' });

    const after = (await db.collection('verificationCodes').doc('student29@ejm.org').get()).data()!;
    expect(after.code).toBe(before.code);
    expect(after.createdAt.toMillis()).toBe(before.createdAt.toMillis());
  });

  it('duplicate email with existing account: silent success, DECOY code doc, notice marker written (issue #148)', async () => {
    // Create a user first
    const { getAdminAuth } = await import('../../setup/emulator.js');
    const auth = getAdminAuth();
    await auth.createUser({ email: 'existing28@ejm.org', password: 'Test1234' });
    const db = getDb();
    const uid = (await auth.getUserByEmail('existing28@ejm.org')).uid;
    await db.collection('users').doc(uid).set({
      uid, email: 'existing28@ejm.org', role: 'babysitter', status: 'active',
    });

    // The response must be indistinguishable from the fresh path.
    const result = await callFunction<{ success: boolean; message: string }>(
      'verifyEjmEmail',
      { email: 'existing28@ejm.org' }
    );
    expect(result).toEqual({ success: true, message: 'Verification code sent' });

    // A decoy code doc exists, byte-shaped like the fresh write (so the code
    // step and the enroll callables error identically to a fresh wrong code)
    // but with an unguessable code the caller never receives...
    const codeDoc = await db.collection('verificationCodes').doc('existing28@ejm.org').get();
    expect(codeDoc.exists).toBe(true);
    const data = codeDoc.data()!;
    expect(data.code).toMatch(/^\d{6}$/);
    expect(data.graduationYear).toBe(28);
    expect(data.attempts).toBe(0);

    // ...and the mailbox owner got the account-exists notice instead.
    const notice = await db.collection('accountExistsNotices').doc('existing28@ejm.org').get();
    expect(notice.exists).toBe(true);
    expect(notice.data()!.lastSentAt).toBeTruthy();
  });
});
