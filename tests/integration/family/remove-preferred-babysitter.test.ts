import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

describe('removePreferredBabysitter', () => {
  let seed: SeedData;
  let parent1Token: string;
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
  });

  afterAll(async () => { await clearAll(); });

  beforeEach(async () => {
    const db = getDb();
    await db.collection('families').doc(seed.family1Id).update({ preferredBabysitters: [seed.babysitter1.uid, seed.babysitter2.uid] });
  });

  it('removes the babysitter from preferredBabysitters', async () => {
    const result = await callFunction<{ success: boolean }>('removePreferredBabysitter', { babysitterUserId: seed.babysitter1.uid }, parent1Token);
    expect(result.success).toBe(true);
    const db = getDb();
    const fam = await db.collection('families').doc(seed.family1Id).get();
    const arr = fam.data()!.preferredBabysitters as string[];
    expect(arr).not.toContain(seed.babysitter1.uid);
    expect(arr).toContain(seed.babysitter2.uid);
  });

  it('is a no-op when not in array', async () => {
    const result = await callFunction<{ success: boolean }>('removePreferredBabysitter', { babysitterUserId: seed.babysitter3.uid }, parent1Token);
    expect(result.success).toBe(true);
  });

  it('rejects babysitters', async () => {
    await expect(callFunction('removePreferredBabysitter', { babysitterUserId: seed.babysitter2.uid }, babysitterToken)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
