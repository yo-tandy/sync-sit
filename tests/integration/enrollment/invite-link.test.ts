import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

describe('invite link flow', () => {
  let seed: SeedData;
  let parentToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parentToken = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  it('generates an invite link for family members', async () => {
    const result = await callFunction<{ token: string }>(
      'generateInviteLink',
      { familyId: seed.family1Id },
      parentToken
    );

    expect(result.token).toBeTruthy();
    expect(result.token.length).toBe(64); // 32 random bytes = 64 hex chars

    // Verify invite doc exists in Firestore
    const db = getDb();
    const inviteDoc = await db.collection('inviteLinks').doc(result.token).get();
    expect(inviteDoc.exists).toBe(true);
    expect(inviteDoc.data()!.familyId).toBe(seed.family1Id);
    expect(inviteDoc.data()!.used).toBe(false);
  });

  it('rejects unauthenticated invite generation', async () => {
    await expect(
      callFunction('generateInviteLink', { familyId: seed.family1Id })
    ).rejects.toThrow();
  });

  it('rejects invite generation by non-family member', async () => {
    // parent3 is in family2, not family1
    const parent3Token = await getIdToken(seed.parent3.uid);
    await expect(
      callFunction('generateInviteLink', { familyId: seed.family1Id }, parent3Token)
    ).rejects.toThrow();
  });
});
