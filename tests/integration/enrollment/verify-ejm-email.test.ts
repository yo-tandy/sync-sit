import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

describe('verifyEjmEmail cross-app cases', () => {
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

  it('authenticated user can request a code for their own account email', async () => {
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

  it("authenticated user cannot request a code for someone else's account email", async () => {
    const token = await getIdToken(seed.parent1.uid);
    await expect(
      callFunction('verifyEjmEmail', { email: seed.babysitter1.email }, token),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'account-exists' },
    });
  });

  it('unauthenticated request for an existing email is still rejected with account-exists details', async () => {
    await expect(
      callFunction('verifyEjmEmail', { email: seed.babysitter1.email }),
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { reason: 'account-exists' },
    });
  });
});
