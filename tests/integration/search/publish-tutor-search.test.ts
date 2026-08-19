import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('publishTutorSearch (study)', () => {
  let seed: SeedData;
  let parentToken: string; // parent1 (verified family1)
  let unverifiedToken: string; // parent3 (unverified family2)

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parentToken = await getIdToken(seed.parent1.uid);
    unverifiedToken = await getIdToken(seed.parent3.uid);
    // The seed's family docs predate the postcode/city fields (#167); the
    // publish callable resolves the published area label from them.
    await getDb().collection('families').doc(seed.family1Id).update({
      postcode: '75016',
      city: 'Paris',
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const docs = await getDb().collection('publishedSearches').get();
    await Promise.all(docs.docs.map((d) => d.ref.delete()));
  });

  it('rejects unauthenticated calls', async () => {
    await expect(
      callFunction('publishTutorSearch', { subject: 'math', level: '6e' }),
    ).rejects.toThrow();
  });

  it('rejects an unverified family with permission-denied', async () => {
    await expect(
      callFunction('publishTutorSearch', { subject: 'math', level: '6e' }, unverifiedToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a non-parent caller with permission-denied', async () => {
    const tutorToken = await getIdToken(seed.tutor1.uid);
    await expect(
      callFunction('publishTutorSearch', { subject: 'math', level: '6e' }, tutorToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an off-vocabulary subject with invalid-argument', async () => {
    await expect(
      callFunction('publishTutorSearch', { subject: 'alchemy', level: '6e' }, parentToken),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('publishes with server-derived fields, a 7-day expiry, and no latLng', async () => {
    const res = await callFunction<{ publishedSearchId: string }>(
      'publishTutorSearch',
      { subject: 'math', level: '6e', locationPrefs: ['online'], maxRate: 30 },
      parentToken,
    );
    expect(res.publishedSearchId).toBeTruthy();

    const doc = (await getDb().collection('publishedSearches').doc(res.publishedSearchId).get()).data()!;
    expect(doc.app).toBe('study');
    expect(doc.familyId).toBe(seed.family1Id);
    expect(doc.createdByUserId).toBe(seed.parent1.uid);
    expect(doc.familyName).toBe('Dupont');
    expect(doc.subject).toBe('math');
    expect(doc.level).toBe('6e');
    expect(doc.locationPrefs).toEqual(['online']);
    expect(doc.maxRate).toBe(30);
    // Area LABEL only, resolved server-side from the family doc — the client
    // payload has no location input at all, and the doc must carry no latLng.
    expect(doc.areaLabel).toBe('16e');
    expect(doc.address).toBeUndefined();
    expect(doc.latLng).toBeUndefined();
    const expiresMs = doc.expiresAt.toDate().getTime();
    expect(expiresMs).toBeGreaterThan(Date.now() + 6.9 * DAY_MS);
    expect(expiresMs).toBeLessThan(Date.now() + 7.1 * DAY_MS);
  });

  it('defaults optional fields (locationPrefs [], maxRate null)', async () => {
    const res = await callFunction<{ publishedSearchId: string }>(
      'publishTutorSearch',
      { subject: 'physics', level: '3e' },
      parentToken,
    );
    const doc = (await getDb().collection('publishedSearches').doc(res.publishedSearchId).get()).data()!;
    expect(doc.locationPrefs).toEqual([]);
    expect(doc.maxRate).toBeNull();
  });

  it('enforces the 3-active cap per family per app, not counting sit docs', async () => {
    // An active SIT doc for the same family must not count toward the study cap.
    await getDb().collection('publishedSearches').add({
      app: 'sit', familyId: seed.family1Id, expiresAt: new Date(Date.now() + DAY_MS),
    });

    for (const subject of ['math', 'physics', 'english']) {
      await callFunction('publishTutorSearch', { subject, level: '6e' }, parentToken);
    }
    await expect(
      callFunction('publishTutorSearch', { subject: 'math', level: '5e' }, parentToken),
    ).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' });
  });
});
