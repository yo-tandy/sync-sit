import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

interface LookupResult {
  uid: string;
  firstName: string;
  lastName: string;
  worksInYourArea: boolean;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
}

describe('lookupBabysitter', () => {
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

  it('matches on the canonical ROOT ejemEmail, not a stale nested copy', async () => {
    // The lookup moved to getEjemEmail(raw) (issue #203). The RAW doc matters:
    // the flattened babysitter view spreads the nested profile over the root,
    // so passing it would invert root-first precedence (PR #206 review).
    const db = getDb();
    const uid = seed.babysitter2.uid;
    const before = (await db.collection('users').doc(uid).get()).data()!;
    await db.collection('users').doc(uid).update({
      ejemEmail: 'root.canonical@ejm-test.org',
      'profiles.babysitter.ejemEmail': 'stale.nested@ejm-test.org',
    });
    try {
      const hit = await callFunction<{ results: LookupResult[] }>(
        'lookupBabysitter', { query: 'root.canonical@ejm-test.org' }, parent1Token,
      );
      expect(hit.results.find((r) => r.uid === uid)).toBeDefined();
      const miss = await callFunction<{ results: LookupResult[] }>(
        'lookupBabysitter', { query: 'stale.nested@ejm-test.org' }, parent1Token,
      );
      expect(miss.results.find((r) => r.uid === uid)).toBeUndefined();
    } finally {
      await db.collection('users').doc(uid).set(before);
    }
  });

  it('rejects queries shorter than 2 chars', async () => {
    await expect(callFunction('lookupBabysitter', { query: 'L' }, parent1Token)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects babysitters', async () => {
    await expect(callFunction('lookupBabysitter', { query: 'Lea' }, babysitterToken)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  // Issue #437: previously ANY authenticated parent with a familyId could
  // look up any searchable babysitter — no family-verification gate. This
  // brings the bar up to searchBabysitters' and study's lookupTutor's: a
  // fully-verified family. Sophie Martin (parent3/family2) is seeded
  // unverified specifically for this case.
  it('rejects a parent whose family is not fully verified', async () => {
    await expect(
      callFunction('lookupBabysitter', { query: 'Lea' }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('matches by phone number in a different format than it was stored in', async () => {
    const db = getDb();
    const uid = seed.babysitter1.uid;
    const before = (await db.collection('users').doc(uid).get()).data()!;
    await db.collection('users').doc(uid).update({ contactPhone: '06 12 34 56 78' });
    try {
      const { results } = await callFunction<{ results: LookupResult[] }>(
        'lookupBabysitter', { query: '+33 6 12 34 56 78' }, parent1Token,
      );
      expect(results.find((r) => r.uid === uid)).toBeDefined();
    } finally {
      await db.collection('users').doc(uid).set(before);
    }
  });

  it('projects contact fields only for an approved family, mirroring searchBabysitters', async () => {
    const db = getDb();
    const bsRef = db.collection('users').doc(seed.babysitter1.uid);
    const before = (await bsRef.get()).data()!;
    await bsRef.update({
      'profiles.babysitter.approvedFamilies': [seed.family1Id],
      contactEmail: 'fresh@ejm-test.org',
      contactPhone: '+33100000099',
    });
    try {
      const { results } = await callFunction<{ results: LookupResult[] }>(
        'lookupBabysitter', { query: 'Lea' }, parent1Token,
      );
      const row = results.find((r) => r.uid === seed.babysitter1.uid);
      expect(row?.contactEmail).toBe('fresh@ejm-test.org');
      expect(row?.contactPhone).toBe('+33100000099');
    } finally {
      await bsRef.set(before);
    }
  });

  it('omits contact fields for a family the babysitter has not approved', async () => {
    const { results } = await callFunction<{ results: LookupResult[] }>(
      'lookupBabysitter', { query: 'Lea' }, parent1Token,
    );
    const row = results.find((r) => r.uid === seed.babysitter1.uid);
    expect(row?.contactEmail).toBeUndefined();
    expect(row?.contactPhone).toBeUndefined();
  });
});
