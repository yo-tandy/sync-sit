import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

interface LookupResult { uid: string; firstName: string; lastName: string; }

describe('lookupBabysitter — searchable flag', () => {
  let seed: SeedData;
  let parent1Token: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => { await clearAll(); });

  it('excludes babysitters with searchable=false from results', async () => {
    // Tom (babysitter4) has searchable=false — must not appear even when name matches
    const { results } = await callFunction<{ results: LookupResult[] }>(
      'lookupBabysitter',
      { query: 'Tom' },
      parent1Token,
    );
    expect(results.find((r) => r.uid === seed.babysitter4.uid)).toBeUndefined();
  });

  it('returns babysitters with searchable=true', async () => {
    const { results } = await callFunction<{ results: LookupResult[] }>(
      'lookupBabysitter',
      { query: 'Lea' },
      parent1Token,
    );
    expect(results.find((r) => r.uid === seed.babysitter1.uid)).toBeDefined();
  });
});
