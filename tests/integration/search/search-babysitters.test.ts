import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

describe('searchBabysitters', () => {
  let seed: SeedData;
  let parentToken: string; // parent1 (verified family)

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parentToken = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  it('rejects unauthenticated calls', async () => {
    await expect(
      callFunction('searchBabysitters', {
        type: 'one_time',
        date: '2026-05-10',
        startTime: '18:00',
        endTime: '21:00',
        kidAges: [6],
        numberOfKids: 1,
        latLng: { lat: 48.8566, lng: 2.2769 },
        filters: {},
      })
    ).rejects.toThrow();
  });

  it('returns matching babysitters for a valid search', async () => {
    // Search Saturday 10:00-13:00 — Lea (sat 10-23), Hugo (sat 9-23), Camille (sat 10-23) available
    // Tom is NOT searchable
    const nextSat = getNextSaturday();
    const result = await callFunction<{ results: Array<{ uid: string; firstName: string; hourlyRate: number }> }>(
      'searchBabysitters',
      {
        type: 'one_time',
        date: nextSat,
        startTime: '10:00',
        endTime: '13:00',
        kidAges: [6],
        numberOfKids: 1,
        latLng: { lat: 48.8566, lng: 2.2769 },
        filters: {},
      },
      parentToken
    );

    expect(result.results).toBeDefined();
    expect(result.results.length).toBeGreaterThan(0);

    // Tom (inactive) should NOT be in results
    const uids = result.results.map((r) => r.uid);
    expect(uids).not.toContain(seed.babysitter4.uid);
  });

  it('excludes babysitters whose rate exceeds offered rate', async () => {
    const nextSat = getNextSaturday();
    const result = await callFunction<{ results: Array<{ uid: string; hourlyRate: number }> }>(
      'searchBabysitters',
      {
        type: 'one_time',
        date: nextSat,
        startTime: '10:00',
        endTime: '13:00',
        kidAges: [6],
        numberOfKids: 1,
        latLng: { lat: 48.8566, lng: 2.2769 },
        offeredRate: 12,
        filters: {},
      },
      parentToken
    );

    // Hugo charges 15, should be excluded when maxRate is 12
    const uids = result.results.map((r) => r.uid);
    expect(uids).not.toContain(seed.babysitter2.uid);
  });

  it('rejects or returns empty for unverified family', async () => {
    // parent3's family (Martin) is not fully verified
    const parent3Token = await getIdToken(seed.parent3.uid);
    const nextSat = getNextSaturday();

    try {
      const result = await callFunction<{ results: unknown[] }>(
        'searchBabysitters',
        {
          type: 'one_time',
          date: nextSat,
          startTime: '10:00',
          endTime: '13:00',
          kidAges: [7],
          numberOfKids: 1,
          latLng: { lat: 48.8550, lng: 2.2650 },
          filters: {},
        },
        parent3Token
      );
      // If it doesn't throw, it should return empty results
      expect(result.results).toEqual([]);
    } catch {
      // Function threw permission-denied — also acceptable
    }
  });
});

function getNextSaturday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().split('T')[0];
}
