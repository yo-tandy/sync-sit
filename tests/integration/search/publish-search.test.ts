import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" for `days` days from now (UTC date — fine for future-dating). */
function dateFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().split('T')[0];
}

function oneTimePayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'one_time',
    date: dateFromNow(1),
    startTime: '18:00',
    endTime: '22:00',
    kidIds: ['kid1', 'kid2'],
    offeredRate: 15,
    additionalInfo: 'Two easy kids',
    ...overrides,
  };
}

describe('publishSearch (sit)', () => {
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
    await expect(callFunction('publishSearch', oneTimePayload())).rejects.toThrow();
  });

  it('rejects an unverified family with permission-denied', async () => {
    await expect(
      callFunction('publishSearch', oneTimePayload({ kidIds: ['kid4'] }), unverifiedToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a non-parent caller with permission-denied', async () => {
    const sitterToken = await getIdToken(seed.babysitter1.uid);
    await expect(
      callFunction('publishSearch', oneTimePayload(), sitterToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('publishes a one_time search with server-derived, PII-scrubbed fields', async () => {
    const res = await callFunction<{ publishedSearchId: string }>(
      'publishSearch',
      oneTimePayload(),
      parentToken,
    );
    expect(res.publishedSearchId).toBeTruthy();

    const snap = await getDb().collection('publishedSearches').doc(res.publishedSearchId).get();
    expect(snap.exists).toBe(true);
    const doc = snap.data()!;
    expect(doc.app).toBe('sit');
    expect(doc.familyId).toBe(seed.family1Id);
    expect(doc.createdByUserId).toBe(seed.parent1.uid);
    expect(doc.familyName).toBe('Dupont');
    // Ages re-derived server-side from the kid docs (kid1=6, kid2=4).
    expect(doc.kidAges).toEqual([6, 4]);
    expect(doc.numberOfKids).toBe(2);
    // Area LABEL only — resolved from the family doc's postcode.
    expect(doc.areaLabel).toBe('16e');
    // The PII the doc must NEVER carry: address, latLng, kid names.
    expect(doc.address).toBeUndefined();
    expect(doc.latLng).toBeUndefined();
    expect(JSON.stringify(doc)).not.toContain('Lucas');
    expect(doc.type).toBe('one_time');
    expect(doc.startTime).toBe('18:00');
    expect(doc.recurringSlots).toBeNull();
  });

  it('caps one_time expiry at the end of the babysitting day (the min() branch)', async () => {
    // Sitting tomorrow, ending 22:00: expiresAt must be the sitting end —
    // well under 2 days out — not the 7-day default.
    const res = await callFunction<{ publishedSearchId: string }>(
      'publishSearch',
      oneTimePayload({ date: dateFromNow(1) }),
      parentToken,
    );
    const doc = (await getDb().collection('publishedSearches').doc(res.publishedSearchId).get()).data()!;
    const expiresMs = doc.expiresAt.toDate().getTime();
    expect(expiresMs).toBeGreaterThan(Date.now());
    expect(expiresMs).toBeLessThan(Date.now() + 2 * DAY_MS);
  });

  it('caps far-future one_time expiry at 7 days (the other min() branch)', async () => {
    const res = await callFunction<{ publishedSearchId: string }>(
      'publishSearch',
      oneTimePayload({ date: dateFromNow(10) }),
      parentToken,
    );
    const doc = (await getDb().collection('publishedSearches').doc(res.publishedSearchId).get()).data()!;
    const expiresMs = doc.expiresAt.toDate().getTime();
    expect(expiresMs).toBeGreaterThan(Date.now() + 6.9 * DAY_MS);
    expect(expiresMs).toBeLessThan(Date.now() + 7.1 * DAY_MS);
  });

  it('gives recurring searches the flat 7-day expiry and persists the slots', async () => {
    const res = await callFunction<{ publishedSearchId: string }>(
      'publishSearch',
      {
        type: 'recurring',
        recurringSlots: [{ day: 'mon', startTime: '17:00', endTime: '19:00' }],
        schoolWeeksOnly: true,
        kidIds: ['kid1'],
      },
      parentToken,
    );
    const doc = (await getDb().collection('publishedSearches').doc(res.publishedSearchId).get()).data()!;
    expect(doc.type).toBe('recurring');
    expect(doc.date).toBeNull();
    expect(doc.recurringSlots).toEqual([{ day: 'mon', startTime: '17:00', endTime: '19:00' }]);
    expect(doc.schoolWeeksOnly).toBe(true);
    const expiresMs = doc.expiresAt.toDate().getTime();
    expect(expiresMs).toBeGreaterThan(Date.now() + 6.9 * DAY_MS);
    expect(expiresMs).toBeLessThan(Date.now() + 7.1 * DAY_MS);
  });

  it('rejects a past babysitting date with invalid-argument', async () => {
    await expect(
      callFunction('publishSearch', oneTimePayload({ date: '2020-01-01' }), parentToken),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects unknown kidIds with invalid-argument', async () => {
    await expect(
      callFunction('publishSearch', oneTimePayload({ kidIds: ['kid1', 'nope'] }), parentToken),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('enforces the 3-active cap per family per app, not counting expired docs', async () => {
    // An EXPIRED sit doc and an active STUDY doc for the same family: neither
    // may count toward the sit cap.
    const db = getDb();
    await db.collection('publishedSearches').add({
      app: 'sit', familyId: seed.family1Id, expiresAt: new Date(Date.now() - DAY_MS),
    });
    await db.collection('publishedSearches').add({
      app: 'study', familyId: seed.family1Id, expiresAt: new Date(Date.now() + DAY_MS),
    });

    for (let i = 0; i < 3; i++) {
      await callFunction('publishSearch', oneTimePayload({ date: dateFromNow(3 + i) }), parentToken);
    }
    await expect(
      callFunction('publishSearch', oneTimePayload({ date: dateFromNow(6) }), parentToken),
    ).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' });
  });
});
