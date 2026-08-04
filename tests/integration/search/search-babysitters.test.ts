import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
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

// Age backstop (governance PR 1): sit enforces the under-15 floor and the
// DOB/grad-year consistency check at the consumption point — search.
// Fixtures are computed relative to the real clock (September school-year
// boundary), mirroring the tutor-age-gate integration tests.
describe('searchBabysitters age backstop', () => {
  let seed: SeedData;
  let parentToken: string;
  let adminToken: string;

  function schoolYearEnd(): number {
    const d = new Date();
    return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
  }

  function gradYearForExpectedAge(expectedAge: number): number {
    return (schoolYearEnd() + (18 - expectedAge)) % 100;
  }

  /** A DOB Date for someone who turned `age` about five months ago. */
  function dobWithAge(age: number): Date {
    const d = new Date();
    let y = d.getFullYear();
    let m = d.getMonth() - 5;
    if (m < 0) {
      m += 12;
      y -= 1;
    }
    return new Date(`${y - age}-${String(m + 1).padStart(2, '0')}-15T00:00:00Z`);
  }

  async function seedSitter(
    uid: string,
    ejemEmail: string,
    dateOfBirth: Date | null,
  ) {
    await getDb().collection('users').doc(uid).set({
      uid,
      email: ejemEmail,
      status: 'active',
      firstName: `First-${uid}`,
      lastName: `Last-${uid}`,
      ...(dateOfBirth ? { dateOfBirth } : {}),
      profiles: {
        babysitter: {
          enrollmentComplete: true,
          ejemEmail,
          searchable: true,
          gender: 'female',
          classLevel: 'Seconde',
          languages: ['French'],
          kidAgeRange: { min: 0, max: 18 },
          maxKids: 3,
          hourlyRate: 10,
          contactEmail: ejemEmail,
          areaMode: 'arrondissement',
          arrondissements: ['15e', '16e'],
          areaLatLng: { lat: 48.8530, lng: 2.2750 },
        },
      },
      fcmTokens: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const GRAD_15 = gradYearForExpectedAge(15);
  const GRAD_16 = gradYearForExpectedAge(16);

  const UNDER_15_UID = 'bs-gate-under15';
  const MISMATCH_UID = 'bs-gate-mismatch';
  const EXEMPT_UID = 'bs-gate-exempt';
  const NO_DOB_UID = 'bs-gate-nodob';
  const FINE_UID = 'bs-gate-fine';

  const EXEMPT_EMAIL = `gate.exempt${GRAD_15}@ejm.org`;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parentToken = await getIdToken(seed.parent1.uid);
    adminToken = await getIdToken(seed.admin.uid);

    // Under-15 by DOB, email cohort expects 15 (within tolerance — the floor
    // alone must exclude).
    await seedSitter(UNDER_15_UID, `gate.under${GRAD_15}@ejm.org`, dobWithAge(14));
    // DOB says 21, email cohort expects 15 → mismatch beyond one class.
    await seedSitter(MISMATCH_UID, `gate.mismatch${GRAD_15}@ejm.org`, dobWithAge(21));
    // Same mismatch, but with an admin exemption → visible.
    await seedSitter(EXEMPT_UID, EXEMPT_EMAIL, dobWithAge(21));
    await callFunction('setEnrollmentExemption', { email: EXEMPT_EMAIL, note: 'ok' }, adminToken);
    // Legacy profile without a DOB → NOT excluded.
    await seedSitter(NO_DOB_UID, `gate.nodob${GRAD_15}@ejm.org`, null);
    // Consistent 16-year-old → visible.
    await seedSitter(FINE_UID, `gate.fine${GRAD_16}@ejm.org`, dobWithAge(16));
  });

  afterAll(async () => {
    await clearAll();
  });

  async function searchUids(): Promise<string[]> {
    const result = await callFunction<{ results: Array<{ uid: string }> }>(
      'searchBabysitters',
      {
        type: 'one_time',
        date: getNextSaturday(),
        startTime: '10:00',
        endTime: '13:00',
        kidAges: [6],
        numberOfKids: 1,
        latLng: { lat: 48.8566, lng: 2.2769 },
        filters: {},
      },
      parentToken,
    );
    return result.results.map((r) => r.uid);
  }

  it('excludes an under-15 babysitter', async () => {
    expect(await searchUids()).not.toContain(UNDER_15_UID);
  });

  it('excludes a DOB/grad-year mismatched babysitter', async () => {
    expect(await searchUids()).not.toContain(MISMATCH_UID);
  });

  it('includes a mismatched babysitter with an admin exemption', async () => {
    expect(await searchUids()).toContain(EXEMPT_UID);
  });

  it('does NOT exclude a legacy profile missing its DOB', async () => {
    expect(await searchUids()).toContain(NO_DOB_UID);
  });

  it('includes a consistent 16-year-old (regression guard)', async () => {
    expect(await searchUids()).toContain(FINE_UID);
  });
});

function getNextSaturday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  // Format from local components: getDay() above is local, and
  // toISOString() (UTC) would disagree with it around midnight in
  // non-UTC timezones, yielding a Friday or Sunday.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
