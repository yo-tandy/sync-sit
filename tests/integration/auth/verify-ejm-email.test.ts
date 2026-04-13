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

  it('rejects duplicate email with existing account', async () => {
    // Create a user first
    const { getAdminAuth } = await import('../../setup/emulator.js');
    const auth = getAdminAuth();
    await auth.createUser({ email: 'existing28@ejm.org', password: 'Test1234' });
    const db = getDb();
    const uid = (await auth.getUserByEmail('existing28@ejm.org')).uid;
    await db.collection('users').doc(uid).set({
      uid, email: 'existing28@ejm.org', role: 'babysitter', status: 'active',
    });

    await expect(
      callFunction('verifyEjmEmail', { email: 'existing28@ejm.org' })
    ).rejects.toThrow();
  });
});
