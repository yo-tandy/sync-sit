import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

interface Hit {
  uid: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  classLevel: string;
}

// Issue #529 PR1: the family endorsement picker's name search, moved off
// the client (which downloaded every active babysitter's full doc) onto a
// callable that returns only what the picker renders.
describe('findBabysittersForEndorsement', () => {
  let seed: SeedData;
  let parent1Token: string;
  let parent3Token: string;
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
  });

  afterAll(async () => { await clearAll(); });

  it('returns matching active babysitters by partial name, projecting ONLY the five picker fields', async () => {
    const { results } = await callFunction<{ results: Hit[] }>('findBabysittersForEndorsement', { query: 'Lea' }, parent1Token);
    const lea = results.find((r) => r.uid === seed.babysitter1.uid);
    expect(lea).toBeDefined();
    expect(lea!.firstName).toBe('Lea');
    // The whole point: nothing beyond uid/firstName/lastName/photoUrl/classLevel.
    expect(Object.keys(lea!).sort()).toEqual(['classLevel', 'firstName', 'lastName', 'photoUrl', 'uid']);
  });

  it('matches case-insensitively across "first last"', async () => {
    const { results } = await callFunction<{ results: Hit[] }>('findBabysittersForEndorsement', { query: 'a bern' }, parent1Token);
    expect(results.map((r) => r.uid)).toContain(seed.babysitter1.uid);
  });

  it("includes a babysitter hidden from search (searchable: false) — endorsement is not discovery, the page's own rule", async () => {
    const { results } = await callFunction<{ results: Hit[] }>('findBabysittersForEndorsement', { query: 'Tom' }, parent1Token);
    expect(results.map((r) => r.uid)).toContain(seed.babysitter4.uid);
  });

  it('never returns parents, tutors or admins', async () => {
    const { results } = await callFunction<{ results: Hit[] }>('findBabysittersForEndorsement', { query: 'a' + 'r' }, parent1Token);
    const uids = results.map((r) => r.uid);
    expect(uids).not.toContain(seed.parent1.uid);
    expect(uids).not.toContain(seed.parent3.uid);
    expect(uids).not.toContain(seed.admin.uid);
    expect(uids).not.toContain(seed.tutor1.uid);
  });

  it('a parent whose family is NOT verified may still search (references do not require verification today)', async () => {
    const { results } = await callFunction<{ results: Hit[] }>('findBabysittersForEndorsement', { query: 'Lea' }, parent3Token);
    expect(results.map((r) => r.uid)).toContain(seed.babysitter1.uid);
  });

  it('rejects babysitters', async () => {
    await expect(
      callFunction('findBabysittersForEndorsement', { query: 'Lea' }, babysitterToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects unauthenticated calls', async () => {
    await expect(callFunction('findBabysittersForEndorsement', { query: 'Lea' })).rejects.toThrow();
  });

  it('rejects queries shorter than 2 chars and longer than 100', async () => {
    await expect(callFunction('findBabysittersForEndorsement', { query: 'L' }, parent1Token)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(callFunction('findBabysittersForEndorsement', { query: 'x'.repeat(101) }, parent1Token)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
