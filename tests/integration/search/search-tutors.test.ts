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
      expect(mixed.results.map((r) => r.uid)).toContain('temp-tutor-mixed');

      const familyOnly = await callFunction<{ results: TutorResult[] }>(
        'searchTutors',
        { subject: 'math', level: '6e', areaLabel: '16e', filters: { locationPrefs: ['family_home'] } },
        parentToken
      );
      expect(familyOnly.results.map((r) => r.uid)).not.toContain('temp-tutor-mixed');
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
