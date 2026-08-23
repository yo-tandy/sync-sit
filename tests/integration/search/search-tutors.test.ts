import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Minimal tutor user doc — status/searchable/enrollmentComplete are the
// candidate-query axes we vary; the offering matches math/6e so exclusion can
// only come from the gate under test. Written directly (no auth user needed:
// candidate tutors never authenticate for search).
function tutorDoc(overrides: {
  uid: string;
  status: string;
  searchable: boolean;
  enrollmentComplete: boolean;
  /** Merged over the default tutor profile — coverage/prefs variations. */
  profile?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    uid: overrides.uid,
    email: `${overrides.uid}@ejm-test.org`,
    status: overrides.status,
    firstName: 'Temp',
    lastName: 'Tutor',
    language: 'fr',
    profiles: {
      tutor: {
        enrollmentComplete: overrides.enrollmentComplete,
        searchable: overrides.searchable,
        ejemEmail: `${overrides.uid}@ejm-test.org`,
        classLevel: 'L3',
        languages: ['French'],
        subjects: [{ subject: 'math', levels: ['6e', '5e', '4e'], rate: 25 }],
        sessionLengthsMin: [60],
        locationPrefs: ['online'],
        paddingMin: 15,
        areaMode: 'distance',
        areaLatLng: { lat: 48.8566, lng: 2.3522 },
        areaRadiusKm: 5,
        ...(overrides.profile ?? {}),
      },
    },
    notifPrefs: {
      newRequest: { push: true, email: true },
      confirmed: { push: true, email: true },
      cancelled: { push: true, email: true },
      reminders: { push: true, email: true },
    },
    fcmTokens: [],
  };
}

interface TutorResult {
  uid: string;
  firstName: string;
  lastName: string;
  subject: string;
  level: string;
  rate: number;
  levels: string[];
  locationPrefs: string[];
  distance: number | null;
  endorsementCount: number;
  requestStatus: string;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
  hourlyRate?: number;
  age?: number;
  maxKids?: number;
}

// Paris center — matches tutor2/tutor3 areaLatLng, so both are within radius.
const PARIS_CENTER = { lat: 48.8566, lng: 2.3522 };

describe('searchTutors', () => {
  let seed: SeedData;
  let parentToken: string; // parent1 (verified family1)

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
      callFunction('searchTutors', {
        subject: 'math',
        level: '6e',
        latLng: PARIS_CENTER,
      })
    ).rejects.toThrow();
  });

  it('rejects a tutor-token caller with permission-denied', async () => {
    const tutorToken = await getIdToken(seed.tutor2.uid);
    try {
      await callFunction(
        'searchTutors',
        { subject: 'math', level: '6e', latLng: PARIS_CENTER },
        tutorToken
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('PERMISSION_DENIED');
    }
  });

  it('rejects an unverified family with permission-denied', async () => {
    // parent3's family (Martin) is not fully verified.
    const parent3Token = await getIdToken(seed.parent3.uid);
    try {
      await callFunction(
        'searchTutors',
        { subject: 'math', level: '6e', latLng: PARIS_CENTER },
        parent3Token
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('PERMISSION_DENIED');
    }
  });

  it('returns tutor2 ONLY (excludes legacy tutor1 enrollmentComplete=false, tutor3 searchable=false)', async () => {
    const result = await callFunction<{ results: TutorResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: PARIS_CENTER },
      parentToken
    );
    const uids = result.results.map((r) => r.uid);
    expect(uids).toContain(seed.tutor2.uid);
    expect(uids).not.toContain(seed.tutor1.uid);
    expect(uids).not.toContain(seed.tutor3.uid);
    expect(result.results).toHaveLength(1);
  });

  it('excludes tutors who do not offer the searched subject', async () => {
    // No tutor offers 'physics'.
    const result = await callFunction<{ results: TutorResult[] }>(
      'searchTutors',
      { subject: 'physics', level: '6e', latLng: PARIS_CENTER },
      parentToken
    );
    expect(result.results).toHaveLength(0);
  });

  it('excludes a tutor who offers the subject but not the searched level', async () => {
    // tutor2 offers english only at '6e'; searching english '4e' must miss.
    const result = await callFunction<{ results: TutorResult[] }>(
      'searchTutors',
      { subject: 'english', level: '4e', latLng: PARIS_CENTER },
      parentToken
    );
    const uids = result.results.map((r) => r.uid);
    expect(uids).not.toContain(seed.tutor2.uid);
    expect(result.results).toHaveLength(0);
  });

  it('applies maxRate filter — excludes tutor2 math@25 when maxRate is 20', async () => {
    const result = await callFunction<{ results: TutorResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: PARIS_CENTER, filters: { maxRate: 20 } },
      parentToken
    );
    const uids = result.results.map((r) => r.uid);
    expect(uids).not.toContain(seed.tutor2.uid);
    expect(result.results).toHaveLength(0);
  });

  it('applies locationPref filter — excludes tutor2 when requiring library', async () => {
    // tutor2 accepts only ['online', 'family_home'].
    const result = await callFunction<{ results: TutorResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: PARIS_CENTER, filters: { locationPref: 'library' } },
      parentToken
    );
    const uids = result.results.map((r) => r.uid);
    expect(uids).not.toContain(seed.tutor2.uid);
    expect(result.results).toHaveLength(0);
  });

  it('reports endorsementCount 0 as a baseline (no study endorsements seeded)', async () => {
    const result = await callFunction<{ results: TutorResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: PARIS_CENTER },
      parentToken
    );
    const t2 = result.results.find((r) => r.uid === seed.tutor2.uid);
    expect(t2?.endorsementCount).toBe(0);
  });

  it('reports requestStatus "none" as a baseline (no contact requests seeded)', async () => {
    const result = await callFunction<{ results: TutorResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: PARIS_CENTER },
      parentToken
    );
    const t2 = result.results.find((r) => r.uid === seed.tutor2.uid);
    expect(t2?.requestStatus).toBe('none');
  });

  it('does NOT project contact fields when the family is not approved', async () => {
    const result = await callFunction<{ results: TutorResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: PARIS_CENTER },
      parentToken
    );
    const t2 = result.results.find((r) => r.uid === seed.tutor2.uid);
    expect(t2).toBeDefined();
    expect(t2?.contactEmail).toBeUndefined();
    expect(t2?.contactPhone).toBeUndefined();
    expect(t2?.whatsapp).toBeUndefined();
  });

  it('projects the MATCHED subject rate and carries no babysitter-shaped fields', async () => {
    const result = await callFunction<{ results: TutorResult[] }>(
      'searchTutors',
      { subject: 'english', level: '6e', latLng: PARIS_CENTER },
      parentToken
    );
    const t2 = result.results.find((r) => r.uid === seed.tutor2.uid);
    expect(t2).toBeDefined();
    // english offering rate is 22 (NOT the math rate of 25).
    expect(t2?.rate).toBe(22);
    expect(t2?.subject).toBe('english');
    expect(t2?.level).toBe('6e');
    // No babysitter payload leakage.
    expect(t2?.hourlyRate).toBeUndefined();
    expect(t2?.age).toBeUndefined();
    expect(t2?.maxKids).toBeUndefined();
  });

  // ── Unconfounded approval-gate negatives ──
  // tutor1 carries BOTH enrollmentComplete:false and searchable:false, so it
  // cannot prove the enrollmentComplete clause on its own. These temp users
  // isolate a single failing axis each.

  it('excludes an active, searchable tutor whose enrollmentComplete is false', async () => {
    const uid = 'temp-tutor-enrollment-false';
    await getDb().collection('users').doc(uid).set(
      tutorDoc({ uid, status: 'active', searchable: true, enrollmentComplete: false })
    );
    try {
      const result = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', latLng: PARIS_CENTER },
        parentToken
      );
      const uids = result.results.map((r) => r.uid);
      expect(uids).not.toContain(uid);
      // tutor2 still the only match — the temp user changed nothing else.
      expect(uids).toEqual([seed.tutor2.uid]);
    } finally {
      await getDb().collection('users').doc(uid).delete();
    }
  });

  it('excludes a searchable, enrolled tutor whose account status is not active', async () => {
    const uid = 'temp-tutor-blocked';
    await getDb().collection('users').doc(uid).set(
      tutorDoc({ uid, status: 'blocked', searchable: true, enrollmentComplete: true })
    );
    try {
      const result = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', latLng: PARIS_CENTER },
        parentToken
      );
      const uids = result.results.map((r) => r.uid);
      expect(uids).not.toContain(uid);
      expect(uids).toEqual([seed.tutor2.uid]);
    } finally {
      await getDb().collection('users').doc(uid).delete();
    }
  });

  // ── Approved families bypass the distance gate ──
  // Deep-link regression: an accepted request deep-links back to search with the
  // family's saved latLng, which may sit outside the tutor's radius. The tutor
  // the family is already approved for must NOT vanish behind the distance cap.
  // ~5.5 km west of Paris center (radius is 5 km): lng 2.2769 @ lat 48.8566.
  const FAR = { lat: 48.8566, lng: 2.2769 };

  it('ROOT contact wins over a stale nested copy in approved-family projections (issue #203)', async () => {
    // The family-consumed disclosure path: after a root-only Account edit the
    // nested copy is stale; the projection must surface the root values
    // (PR #206 review).
    const uid = 'temp-tutor-root-contact';
    const doc = tutorDoc({ uid, status: 'active', searchable: true, enrollmentComplete: true });
    const tutorProfile = (doc.profiles as { tutor: Record<string, unknown> }).tutor;
    tutorProfile.approvedFamilies = [seed.family1Id];
    tutorProfile.contactEmail = 'stale@ejm-test.org';
    tutorProfile.contactPhone = '+33100000001';
    (doc as Record<string, unknown>).contactEmail = 'fresh@ejm-test.org';
    (doc as Record<string, unknown>).contactPhone = '+33100000099';
    await getDb().collection('users').doc(uid).set(doc);
    try {
      const result = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e' },
        parentToken
      );
      const row = result.results.find((r) => r.uid === uid);
      expect(row?.contactEmail).toBe('fresh@ejm-test.org');
      expect(row?.contactPhone).toBe('+33100000099');
    } finally {
      await getDb().collection('users').doc(uid).delete();
    }
  });

  it('returns an APPROVED tutor beyond the distance radius, with contact fields', async () => {
    const uid = 'temp-tutor-approved-far';
    const doc = tutorDoc({ uid, status: 'active', searchable: true, enrollmentComplete: true });
    const tutorProfile = (doc.profiles as { tutor: Record<string, unknown> }).tutor;
    tutorProfile.approvedFamilies = [seed.family1Id];
    tutorProfile.contactEmail = 'temp@ejm-test.org';
    tutorProfile.contactPhone = '+33100000000';
    tutorProfile.whatsapp = '+33100000000';
    await getDb().collection('users').doc(uid).set(doc);
    try {
      const result = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', latLng: FAR },
        parentToken
      );
      const row = result.results.find((r) => r.uid === uid);
      expect(row).toBeDefined();
      // Still surfaces a (now out-of-radius) distance for display.
      expect(row?.distance).not.toBeNull();
      // Contact fields projected because the family is approved.
      expect(row?.contactEmail).toBe('temp@ejm-test.org');
      expect(row?.contactPhone).toBe('+33100000000');
    } finally {
      await getDb().collection('users').doc(uid).delete();
    }
  });

  it('still EXCLUDES a non-approved tutor beyond the distance radius (gate intact for strangers)', async () => {
    const uid = 'temp-tutor-unapproved-far';
    await getDb().collection('users').doc(uid).set(
      tutorDoc({ uid, status: 'active', searchable: true, enrollmentComplete: true })
    );
    try {
      const result = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', latLng: FAR },
        parentToken
      );
      const uids = result.results.map((r) => r.uid);
      expect(uids).not.toContain(uid);
    } finally {
      await getDb().collection('users').doc(uid).delete();
    }
  });

  // ── Coverage-area filtering (issue #167) ──
  // Requirement 1's trust boundary: a location-typed query must never return
  // a tutor whose coverage cannot serve it. `areaLabel` is the family
  // address resolved client-side to the arrondissement/town vocabulary.

  async function withTempTutor(
    uid: string,
    profile: Record<string, unknown>,
    fn: () => Promise<void>,
  ) {
    await getDb().collection('users').doc(uid).set(
      tutorDoc({ uid, status: 'active', searchable: true, enrollmentComplete: true, profile })
    );
    try {
      await fn();
    } finally {
      await getDb().collection('users').doc(uid).delete();
    }
  }

  const ARR_16E_FAMILY_HOME = {
    areaMode: 'arrondissement',
    arrondissements: ['16e', 'Vincennes'],
    areaLatLng: null,
    areaRadiusKm: null,
    locationPrefs: ['family_home'],
  };

  it('returns an arrondissement tutor for a family_home query in a covered area', async () => {
    await withTempTutor('temp-tutor-arr-covered', ARR_16E_FAMILY_HOME, async () => {
      const result = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', areaLabel: '16e', filters: { locationPrefs: ['family_home'] } },
        parentToken
      );
      expect(result.results.map((r) => r.uid)).toContain('temp-tutor-arr-covered');
    });
  });

  it('excludes the arrondissement tutor for an UNCOVERED area label', async () => {
    await withTempTutor('temp-tutor-arr-uncovered', ARR_16E_FAMILY_HOME, async () => {
      const result = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', areaLabel: '5e', filters: { locationPrefs: ['family_home'] } },
        parentToken
      );
      expect(result.results.map((r) => r.uid)).not.toContain('temp-tutor-arr-uncovered');
    });
  });

  it('excludes the arrondissement tutor when no areaLabel could be resolved', async () => {
    await withTempTutor('temp-tutor-arr-nolabel', ARR_16E_FAMILY_HOME, async () => {
      const result = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', filters: { locationPrefs: ['family_home'] } },
        parentToken
      );
      expect(result.results.map((r) => r.uid)).not.toContain('temp-tutor-arr-nolabel');
    });
  });

  it('treats an over-long areaLabel as absent (degrades, never invalid-argument)', async () => {
    await withTempTutor('temp-tutor-arr-longlabel', ARR_16E_FAMILY_HOME, async () => {
      const result = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        {
          subject: 'math',
          level: '6e',
          areaLabel: 'x'.repeat(31),
          filters: { locationPrefs: ['family_home'] },
        },
        parentToken
      );
      expect(result.results.map((r) => r.uid)).not.toContain('temp-tutor-arr-longlabel');
    });
  });

  it("matches a legacy postcode-vocabulary tutor (['75016']) against areaLabel '16e'", async () => {
    // Free-text-era docs store postcodes; the callable normalizes the tutor
    // side through postcodeToArrondissement so shipped coverage keeps working.
    await withTempTutor(
      'temp-tutor-legacy-postcode',
      { areaMode: 'arrondissement', arrondissements: ['75016'], areaLatLng: null, areaRadiusKm: null, locationPrefs: ['family_home'] },
      async () => {
        const covered = await callFunction<{ results: TutorResult[] }>(
          'searchTutors',
          { subject: 'math', level: '6e', areaLabel: '16e', filters: { locationPrefs: ['family_home'] } },
          parentToken
        );
        expect(covered.results.map((r) => r.uid)).toContain('temp-tutor-legacy-postcode');

        // Still excluded for an area the stored postcode does NOT map to.
        const uncovered = await callFunction<{ results: TutorResult[] }>(
          'searchTutors',
          { subject: 'math', level: '6e', areaLabel: '5e', filters: { locationPrefs: ['family_home'] } },
          parentToken
        );
        expect(uncovered.results.map((r) => r.uid)).not.toContain('temp-tutor-legacy-postcode');
      }
    );
  });

  it('excludes distance-mode tutors from a family_home query with NO latLng (mode symmetry)', async () => {
    // tutor2 is distance-mode WITH coordinates and accepts family_home; a
    // family that provides no coordinates cannot be reached-checked, so the
    // tutor fails closed — exactly like an arr-mode tutor with no areaLabel.
    const noCoords = await callFunction<{ results: TutorResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', filters: { locationPrefs: ['family_home'] } },
      parentToken
    );
    expect(noCoords.results.map((r) => r.uid)).not.toContain(seed.tutor2.uid);

    // Same query WITH coordinates returns tutor2 (in radius) — the exclusion
    // above is the missing-latLng gate, not something else.
    const withCoords = await callFunction<{ results: TutorResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: PARIS_CENTER, filters: { locationPrefs: ['family_home'] } },
      parentToken
    );
    expect(withCoords.results.map((r) => r.uid)).toContain(seed.tutor2.uid);
  });

  it('ignores coverage for an online-only query', async () => {
    // Same empty-reach shape but the tutor also works online; an online query
    // needs no area at all.
    await withTempTutor(
      'temp-tutor-online-nocover',
      { areaMode: 'arrondissement', arrondissements: [], areaLatLng: null, areaRadiusKm: null, locationPrefs: ['online', 'family_home'] },
      async () => {
        const result = await callFunction<{ results: TutorResult[] }>(
          'searchTutors',
          { subject: 'math', level: '6e', filters: { locationPrefs: ['online'] } },
          parentToken
        );
        expect(result.results.map((r) => r.uid)).toContain('temp-tutor-online-nocover');
      }
    );
  });

  it('mixed query (online + family_home): an uncovered tutor rides in on the online leg only', async () => {
    const profile = {
      areaMode: 'arrondissement',
      arrondissements: [],
      areaLatLng: null,
      areaRadiusKm: null,
      locationPrefs: ['online', 'family_home'],
    };
    await withTempTutor('temp-tutor-mixed', profile, async () => {
      const mixed = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', areaLabel: '16e', filters: { locationPrefs: ['online', 'family_home'] } },
        parentToken
      );
      const row = mixed.results.find((r) => r.uid === 'temp-tutor-mixed');
      expect(row).toBeDefined();
      // Card honesty: the projected prefs are narrowed to the legs that
      // actually serve THIS family — family_home is dropped because the
      // tutor's coverage cannot reach them.
      expect(row?.locationPrefs).toEqual(['online']);

      const familyOnly = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', areaLabel: '16e', filters: { locationPrefs: ['family_home'] } },
        parentToken
      );
      expect(familyOnly.results.map((r) => r.uid)).not.toContain('temp-tutor-mixed');
    });
  });

  it('projects the FULL prefs for a COVERED family-side match (subtract, never intersect)', async () => {
    await withTempTutor('temp-tutor-covered-prefs', ARR_16E_FAMILY_HOME, async () => {
      const result = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', areaLabel: '16e', filters: { locationPrefs: ['family_home'] } },
        parentToken
      );
      const row = result.results.find((r) => r.uid === 'temp-tutor-covered-prefs');
      expect(row?.locationPrefs).toEqual(['family_home']);
    });
  });

  it('a covered family_home search still returns the tutor UNREQUESTED online leg (booking needs it)', async () => {
    // The projection subtracts UNREACHABLE legs only — filtering by
    // family_home must not strip the online leg the booking form offers.
    await withTempTutor(
      'temp-tutor-full-prefs',
      { ...ARR_16E_FAMILY_HOME, locationPrefs: ['online', 'family_home'] },
      async () => {
        const result = await callFunction<{ results: TutorResult[] }>(
          'searchTutors',
          { subject: 'math', level: '6e', areaLabel: '16e', filters: { locationPrefs: ['family_home'] } },
          parentToken
        );
        const row = result.results.find((r) => r.uid === 'temp-tutor-full-prefs');
        expect(row?.locationPrefs).toEqual(['online', 'family_home']);
      }
    );
  });

  it('distance-mode far-away tutor rides in on the online leg of a mixed query (family_home subtracted)', async () => {
    // Geography constrains only family-side legs in BOTH area modes: the
    // radius result feeds coverage, it no longer drops the whole tutor when
    // a tutor-side leg matched. FAR is ~5.5 km from the tutor's 5 km radius.
    await withTempTutor(
      'temp-tutor-far-mixed',
      { locationPrefs: ['online', 'family_home'] },
      async () => {
        const result = await callFunction<{ results: TutorResult[] }>(
          'searchTutors',
          { subject: 'math', level: '6e', latLng: FAR, filters: { locationPrefs: ['online', 'family_home'] } },
          parentToken
        );
        const row = result.results.find((r) => r.uid === 'temp-tutor-far-mixed');
        expect(row).toBeDefined();
        expect(row?.locationPrefs).toEqual(['online']);
      }
    );
  });

  it("matches a family whose address resolves to a nearby town ('Vincennes') end to end", async () => {
    await withTempTutor('temp-tutor-town', ARR_16E_FAMILY_HOME, async () => {
      const result = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', areaLabel: 'Vincennes', filters: { locationPrefs: ['family_home'] } },
        parentToken
      );
      expect(result.results.map((r) => r.uid)).toContain('temp-tutor-town');
    });
  });

  it('returns a zero-coverage in-person tutor for an UNTYPED query, with the unreachable legs subtracted', async () => {
    // Location-untyped searches skip the coverage INCLUSION gate by design:
    // excluding these tutors would also hide their online capability from
    // families who have not narrowed by location at all. The PROJECTION is
    // still honest everywhere: family-side legs the coverage cannot serve
    // are subtracted on the untyped path too, so the default search never
    // advertises "at your home" for an unreachable tutor.
    await withTempTutor(
      'temp-tutor-untyped',
      { areaMode: 'arrondissement', arrondissements: [], areaLatLng: null, areaRadiusKm: null, locationPrefs: ['online', 'family_home'] },
      async () => {
        const result = await callFunction<{ results: TutorResult[] }>(
          'searchTutors',
          { subject: 'math', level: '6e', latLng: PARIS_CENTER },
          parentToken
        );
        const row = result.results.find((r) => r.uid === 'temp-tutor-untyped');
        expect(row).toBeDefined();
        expect(row?.locationPrefs).toEqual(['online']);
      }
    );
  });

  it('applies maxDistanceKm as a whole-tutor gate even when a tutor-side leg matched', async () => {
    // The family's explicit ceiling is not tutor coverage — it applies to
    // every leg (a family capping distance wants nearby tutors, and the UI
    // shows the input unconditionally). FAR is ~5.5 km out.
    await withTempTutor(
      'temp-tutor-maxdist-typed',
      { locationPrefs: ['tutor_home'], areaRadiusKm: 50 },
      async () => {
        const capped = await callFunction<{ results: TutorResult[] }>(
          'searchTutors',
          { subject: 'math', level: '6e', latLng: FAR, filters: { locationPrefs: ['tutor_home'], maxDistanceKm: 1 } },
          parentToken
        );
        expect(capped.results.map((r) => r.uid)).not.toContain('temp-tutor-maxdist-typed');

        // Without the cap the same tutor-side query includes the tutor (the
        // tutor's own radius does not whole-drop typed queries).
        const uncapped = await callFunction<{ results: TutorResult[] }>(
          'searchTutors',
          { subject: 'math', level: '6e', latLng: FAR, filters: { locationPrefs: ['tutor_home'] } },
          parentToken
        );
        expect(uncapped.results.map((r) => r.uid)).toContain('temp-tutor-maxdist-typed');
      }
    );
  });

  it('applies maxDistanceKm on UNTYPED queries too (pre-#167 filter semantics)', async () => {
    // areaRadiusKm 50 keeps the tutor within their OWN radius at FAR, so the
    // exclusion below is attributable to maxDistanceKm alone.
    await withTempTutor(
      'temp-tutor-maxdist-untyped',
      { areaRadiusKm: 50 },
      async () => {
        const result = await callFunction<{ results: TutorResult[] }>(
          'searchTutors',
          { subject: 'math', level: '6e', latLng: FAR, filters: { maxDistanceKm: 1 } },
          parentToken
        );
        expect(result.results.map((r) => r.uid)).not.toContain('temp-tutor-maxdist-untyped');
      }
    );
  });

  it('approved family keeps an arr-mode tutor on a typed family_home query despite a non-matching label', async () => {
    // Relationship over geography holds in BOTH modes: consent overrides the
    // label match just like it overrides the distance radius.
    const profile = {
      areaMode: 'arrondissement',
      arrondissements: ['5e'],
      areaLatLng: null,
      areaRadiusKm: null,
      locationPrefs: ['family_home'],
      approvedFamilies: [seed.family1Id],
    };
    await withTempTutor('temp-tutor-approved-label', profile, async () => {
      const result = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', areaLabel: '16e', filters: { locationPrefs: ['family_home'] } },
        parentToken
      );
      const row = result.results.find((r) => r.uid === 'temp-tutor-approved-label');
      expect(row).toBeDefined();
      // And the family-side leg stays projected (covers via approval).
      expect(row?.locationPrefs).toEqual(['family_home']);
    });
  });

  it('never returns an EMPTY-coverage family_home tutor for family_home queries (requirement teeth)', async () => {
    // Arrondissement mode with nothing selected — the fresh-enrollee default.
    await withTempTutor(
      'temp-tutor-empty-arr',
      { areaMode: 'arrondissement', arrondissements: [], areaLatLng: null, areaRadiusKm: null, locationPrefs: ['family_home'] },
      async () => {
        const result = await callFunction<{ results: TutorResult[] }>(
          'searchTutors',
          { subject: 'math', level: '6e', areaLabel: '16e', filters: { locationPrefs: ['family_home'] } },
          parentToken
        );
        expect(result.results.map((r) => r.uid)).not.toContain('temp-tutor-empty-arr');
      }
    );
    // Distance mode without coordinates — legacy no-geocode enrollee.
    await withTempTutor(
      'temp-tutor-empty-dist',
      { areaMode: 'distance', arrondissements: [], areaLatLng: null, areaRadiusKm: null, locationPrefs: ['family_home'] },
      async () => {
        const result = await callFunction<{ results: TutorResult[] }>(
          'searchTutors',
          { subject: 'math', level: '6e', latLng: PARIS_CENTER, filters: { locationPrefs: ['family_home'] } },
          parentToken
        );
        expect(result.results.map((r) => r.uid)).not.toContain('temp-tutor-empty-dist');
      }
    );
  });

  it('legacy single locationPref still works — both the include and the coverage gate', async () => {
    // Positive: tutor2 accepts online; the single form still matches.
    const online = await callFunction<{ results: TutorResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: PARIS_CENTER, filters: { locationPref: 'online' } },
      parentToken
    );
    expect(online.results.map((r) => r.uid)).toContain(seed.tutor2.uid);

    // The single form is normalized into the same coverage gate: an
    // empty-coverage family_home tutor stays hidden.
    await withTempTutor(
      'temp-tutor-legacy-single',
      { areaMode: 'arrondissement', arrondissements: [], areaLatLng: null, areaRadiusKm: null, locationPrefs: ['family_home'] },
      async () => {
        const result = await callFunction<{ results: TutorResult[] }>(
          'searchTutors',
          { subject: 'math', level: '6e', areaLabel: '16e', filters: { locationPref: 'family_home' } },
          parentToken
        );
        expect(result.results.map((r) => r.uid)).not.toContain('temp-tutor-legacy-single');
      }
    );
  });

  it('rejects out-of-range latLng with invalid-argument', async () => {
    try {
      await callFunction(
        'searchTutors',
        { subject: 'math', level: '6e', latLng: { lat: 999, lng: 0 } },
        parentToken
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('INVALID_ARGUMENT');
    }
  });
});
