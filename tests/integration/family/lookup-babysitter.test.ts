import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

interface LookupResult { uid: string; firstName: string; lastName: string; worksInYourArea: boolean; }

describe('lookupBabysitter', () => {
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

  it('returns matching babysitter by partial name', async () => {
    const { results } = await callFunction<{ results: LookupResult[] }>('lookupBabysitter', { query: 'Lea' }, parent1Token);
    const lea = results.find((r) => r.uid === seed.babysitter1.uid);
    expect(lea).toBeDefined();
    expect(lea!.firstName).toBe('Lea');
  });

  it('matches by exact email', async () => {
    const { results } = await callFunction<{ results: LookupResult[] }>('lookupBabysitter', { query: 'camille.moreau@ejm.org' }, parent1Token);
    expect(results.find((r) => r.uid === seed.babysitter3.uid)).toBeDefined();
  });

  it('rejects queries shorter than 2 chars', async () => {
    await expect(callFunction('lookupBabysitter', { query: 'L' }, parent1Token)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects babysitters', async () => {
    await expect(callFunction('lookupBabysitter', { query: 'Lea' }, babysitterToken)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
