import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

interface Summary {
  uid: string;
  firstName: string;
  lastName: string;
  age?: number;
  classLevel?: string;
  worksInYourArea: boolean;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
}

const FORBIDDEN_KEYS = ['dateOfBirth', 'address', 'ejemEmail', 'approvedFamilies', 'fcmTokens', 'notifPrefs', 'email', 'status', 'profiles'];

// Issue #529 PR2: the by-uid babysitter reads of the three family pages,
// moved behind a callable that derives what the page needs and never
// returns the doc.
describe('getBabysitterSummaries', () => {
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
    const db = getDb();
    // bs1 approved family1 (the contact-sharing gate); bs2 has a CONFIRMED
    // appointment with family1; bs3 has neither.
    await db.collection('users').doc(seed.babysitter1.uid).update({
      'profiles.babysitter.approvedFamilies': [seed.family1Id],
    });
    await seedAppointment({
      babysitterUserId: seed.babysitter2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
      date: '2027-06-07', startTime: '18:00', endTime: '20:00',
    });
  });

  afterAll(async () => { await clearAll(); });

  it('returns a derived summary — age computed, no date of birth, address, identity or push data', async () => {
    const { summaries } = await callFunction<{ summaries: Summary[] }>('getBabysitterSummaries', { uids: [seed.babysitter3.uid] }, parent1Token);
    expect(summaries).toHaveLength(1);
    const s = summaries[0];
    expect(s.uid).toBe(seed.babysitter3.uid);
    expect(s.firstName).toBe('Camille');
    expect(typeof s.age).toBe('number');
    for (const k of FORBIDDEN_KEYS) expect(s).not.toHaveProperty(k);
  });

  it('projects contact ONLY for an approved family or a confirmed appointment', async () => {
    const { summaries } = await callFunction<{ summaries: Summary[] }>(
      'getBabysitterSummaries',
      { uids: [seed.babysitter1.uid, seed.babysitter2.uid, seed.babysitter3.uid] },
      parent1Token,
    );
    const by = Object.fromEntries(summaries.map((s) => [s.uid, s]));
    // Approved → contact present.
    expect(by[seed.babysitter1.uid].contactEmail).toBeTruthy();
    // Confirmed appointment → contact present.
    expect(by[seed.babysitter2.uid].contactEmail).toBeTruthy();
    // Neither → the keys are ABSENT (not null).
    expect(by[seed.babysitter3.uid]).not.toHaveProperty('contactEmail');
    expect(by[seed.babysitter3.uid]).not.toHaveProperty('contactPhone');
    expect(by[seed.babysitter3.uid]).not.toHaveProperty('whatsapp');
  });

  it('a different family sees no contact for the babysitter who approved family1', async () => {
    const { summaries } = await callFunction<{ summaries: Summary[] }>('getBabysitterSummaries', { uids: [seed.babysitter1.uid] }, parent3Token);
    expect(summaries[0]).not.toHaveProperty('contactEmail');
  });

  it('includes a babysitter hidden from search (searchable: false) — a family may still have them as preferred/booked', async () => {
    const { summaries } = await callFunction<{ summaries: Summary[] }>('getBabysitterSummaries', { uids: [seed.babysitter4.uid] }, parent1Token);
    expect(summaries.map((s) => s.uid)).toContain(seed.babysitter4.uid);
  });

  it('silently skips non-babysitters, unknown uids and inactive babysitters (as the direct read did)', async () => {
    const db = getDb();
    await db.collection('users').doc(seed.babysitter3.uid).update({ status: 'blocked' });
    try {
      const { summaries } = await callFunction<{ summaries: Summary[] }>(
        'getBabysitterSummaries',
        { uids: [seed.tutor1.uid, seed.parent1.uid, 'no-such-uid', seed.babysitter3.uid, seed.babysitter1.uid] },
        parent1Token,
      );
      expect(summaries.map((s) => s.uid)).toEqual([seed.babysitter1.uid]);
    } finally {
      await db.collection('users').doc(seed.babysitter3.uid).update({ status: 'active' });
    }
  });

  it('rejects babysitters and unauthenticated calls', async () => {
    await expect(callFunction('getBabysitterSummaries', { uids: [seed.babysitter2.uid] }, babysitterToken)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(callFunction('getBabysitterSummaries', { uids: [seed.babysitter2.uid] })).rejects.toThrow();
  });

  it('rejects an empty list and more than 50 uids', async () => {
    await expect(callFunction('getBabysitterSummaries', { uids: [] }, parent1Token)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(callFunction('getBabysitterSummaries', { uids: Array.from({ length: 51 }, (_, i) => `u${i}`) }, parent1Token)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
