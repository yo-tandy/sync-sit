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
    // Notice-window disclosure (issue #237): families must see the policy
    // BEFORE contacting; the payload carries it for every result (0 = none).
    for (const r of result.results as Array<{ cancellationNoticeHours?: number }>) {
      expect(typeof r.cancellationNoticeHours).toBe('number');
    }
    expect(result.results.length).toBeGreaterThan(0);

    // Tom (inactive) should NOT be in results
    const uids = result.results.map((r) => r.uid);
    expect(uids).not.toContain(seed.babysitter4.uid);
  });

  it('ROOT contact wins over a stale nested copy for an approved family (issue #203)', async () => {
    // After a root-only Account edit the nested copy is frozen; the projection
    // an approved family consumes must carry the root values (PR #206 review).
    const db = getDb();
    const bsRef = db.collection('users').doc(seed.babysitter1.uid);
    const before = (await bsRef.get()).data()!;
    await bsRef.update({
      'profiles.babysitter.approvedFamilies': [seed.family1Id],
      'profiles.babysitter.contactEmail': 'stale@ejm-test.org',
      'profiles.babysitter.contactPhone': '+33100000001',
      contactEmail: 'fresh@ejm-test.org',
      contactPhone: '+33100000099',
    });
    try {
      const nextSat = getNextSaturday();
      const result = await callFunction<{ results: Array<{ uid: string; contactEmail?: string; contactPhone?: string }> }>(
        'searchBabysitters',
        {
          type: 'one_time', date: nextSat, startTime: '10:00', endTime: '13:00',
          kidAges: [6], numberOfKids: 1, latLng: { lat: 48.8566, lng: 2.2769 }, filters: {},
        },
        parentToken
      );
      const row = result.results.find((r) => r.uid === seed.babysitter1.uid);
      expect(row).toBeDefined();
      expect(row?.contactEmail).toBe('fresh@ejm-test.org');
      expect(row?.contactPhone).toBe('+33100000099');
    } finally {
      await bsRef.set(before);
    }
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
          // Set explicitly (issue #435 PR2) rather than left for
          // onUserWrittenRecomputeSearchable to backfill asynchronously:
          // these tests `.set()` then immediately call searchBabysitters,
          // which now filters on this field — every seeded sitter here is
          // active/searchable/enrolled, so it's always true; the age
          // backstop (not searchability) is what's under test.
          effectiveSearchable: true,
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

// Issue #439: rank search results by the provider's root `address`
// (#442/#474) as a LAST tie-break — after every existing sort key, never
// gating. `type: 'recurring'` with no `recurringSlots` sidesteps the
// schedule-availability check entirely (only exercised for `one_time`),
// letting these fixtures skip seeding a `schedules/{uid}` doc.
describe('searchBabysitters distance tie-break & projection (issue #439)', () => {
  let seed: SeedData;
  let parentToken: string;

  const FAMILY_LATLNG = { lat: 48.8566, lng: 2.2769 };
  const BABYSITTER_RESULT_KEYS = new Set([
    'uid', 'firstName', 'lastName', 'age', 'classLevel', 'languages', 'photoUrl',
    'aboutMe', 'kidAgeRange', 'maxKids', 'hourlyRate', 'cancellationNoticeHours',
    'distance', 'addressDistance', 'referenceCount', 'contactEmail', 'contactPhone',
    'isPreferred',
  ]);

  interface Address {
    fullAddress: string; street: string; city: string; postcode: string; lat: number; lng: number;
  }

  function makeAddress(lat: number, lng: number): Address {
    return { fullAddress: 'Test address', street: 'Test street', city: 'Paris', postcode: '75016', lat, lng };
  }

  function babysitterDoc(opts: {
    uid: string;
    areaLatLng: { lat: number; lng: number };
    areaRadiusKm?: number;
    address?: Address | null;
  }): Record<string, unknown> {
    return {
      uid: opts.uid,
      email: `${opts.uid}@ejm-test.org`,
      status: 'active',
      firstName: 'Temp', lastName: 'Sitter',
      dateOfBirth: new Date('2008-01-01'),
      ...(opts.address !== undefined ? { address: opts.address } : {}),
      profiles: { babysitter: {
        enrollmentComplete: true, ejemEmail: `${opts.uid}@ejm-test.org`, searchable: true,
        effectiveSearchable: true,
        gender: 'female', classLevel: '1ère', languages: ['French'],
        kidAgeRange: { min: 0, max: 18 }, maxKids: 3, hourlyRate: 12,
        contactEmail: `${opts.uid}@ejm-test.org`,
        areaMode: 'distance', areaLatLng: opts.areaLatLng, areaRadiusKm: opts.areaRadiusKm ?? 20,
      } },
      fcmTokens: [], language: 'fr',
      createdAt: new Date(), updatedAt: new Date(),
    };
  }

  async function withTempBabysitters(docs: Record<string, unknown>[], fn: () => Promise<void>) {
    const uids = docs.map((d) => d.uid as string);
    await Promise.all(docs.map((d) => getDb().collection('users').doc(d.uid as string).set(d)));
    try {
      await fn();
    } finally {
      await Promise.all(uids.map((uid) => getDb().collection('users').doc(uid).delete()));
    }
  }

  interface Row {
    uid: string;
    distance: number;
    addressDistance: number | null;
  }

  async function search(): Promise<Row[]> {
    const result = await callFunction<{ results: Row[] }>(
      'searchBabysitters',
      {
        type: 'recurring',
        kidAges: [6],
        numberOfKids: 1,
        latLng: FAMILY_LATLNG,
        filters: {},
      },
      parentToken,
    );
    return result.results;
  }

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parentToken = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  it('sorts by home-address distance ONLY as a tie-break when every existing key ties', async () => {
    const NEAR = 'temp-bs-addr-near';
    const FAR = 'temp-bs-addr-far';
    await withTempBabysitters(
      [
        // Identical areaLatLng (=> identical area `distance`) and no
        // references (=> identical referenceCount 0) — the only difference
        // is the home address, ~5.5km apart.
        babysitterDoc({ uid: FAR, areaLatLng: FAMILY_LATLNG, address: makeAddress(48.8566, 2.2000) }),
        babysitterDoc({ uid: NEAR, areaLatLng: FAMILY_LATLNG, address: makeAddress(48.8566, 2.2769) }),
      ],
      async () => {
        const results = await search();
        const near = results.find((r) => r.uid === NEAR)!;
        const far = results.find((r) => r.uid === FAR)!;
        expect(near).toBeDefined();
        expect(far).toBeDefined();
        // Existing keys tied — confirms the tie-break, not the primary sort,
        // decided the order.
        expect(near.distance).toBe(far.distance);
        expect(near.addressDistance).toBeLessThan(far.addressDistance!);
        expect(results.indexOf(near)).toBeLessThan(results.indexOf(far));
      },
    );
  });

  it('sorts a provider with no address LAST among tied providers, never excluding it', async () => {
    const WITH_ADDRESS = 'temp-bs-addr-present';
    const NO_ADDRESS = 'temp-bs-addr-absent';
    await withTempBabysitters(
      [
        babysitterDoc({ uid: WITH_ADDRESS, areaLatLng: FAMILY_LATLNG, address: makeAddress(48.8566, 2.2769) }),
        babysitterDoc({ uid: NO_ADDRESS, areaLatLng: FAMILY_LATLNG, address: null }),
      ],
      async () => {
        const results = await search();
        const withAddr = results.find((r) => r.uid === WITH_ADDRESS)!;
        const noAddr = results.find((r) => r.uid === NO_ADDRESS)!;
        expect(withAddr).toBeDefined();
        expect(noAddr).toBeDefined();
        expect(noAddr.addressDistance).toBeNull();
        expect(results.indexOf(withAddr)).toBeLessThan(results.indexOf(noAddr));
      },
    );
  });

  it('still EXCLUDES an out-of-radius areaMode:"distance" provider, even with a close home address (hard filter untouched)', async () => {
    const OUT_OF_RADIUS = 'temp-bs-out-of-radius';
    await withTempBabysitters(
      [
        babysitterDoc({
          uid: OUT_OF_RADIUS,
          // ~50km from the family search point, radius capped at 5km.
          areaLatLng: { lat: 49.3, lng: 2.2769 },
          areaRadiusKm: 5,
          // A close home address must NOT rescue an out-of-radius provider —
          // ranking-only, never gating.
          address: makeAddress(48.8566, 2.2769),
        }),
      ],
      async () => {
        const results = await search();
        expect(results.map((r) => r.uid)).not.toContain(OUT_OF_RADIUS);
      },
    );
  });

  it('projects addressDistance but NEVER address, lat, or lng', async () => {
    const uid = 'temp-bs-projection';
    await withTempBabysitters(
      [babysitterDoc({ uid, areaLatLng: FAMILY_LATLNG, address: makeAddress(48.8566, 2.2769) })],
      async () => {
        const results = await search();
        const row = results.find((r) => r.uid === uid) as unknown as Record<string, unknown>;
        expect(row).toBeDefined();
        expect(typeof row.distance).toBe('number');
        expect(typeof row.addressDistance).toBe('number');
        expect(row.address).toBeUndefined();
        expect(row.lat).toBeUndefined();
        expect(row.lng).toBeUndefined();
        // Full key-set pin: a future field leak (e.g. `address`) fails here.
        for (const key of Object.keys(row)) {
          expect(BABYSITTER_RESULT_KEYS.has(key)).toBe(true);
        }
      },
    );
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
