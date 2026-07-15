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

  it('returns tutor2 ONLY (approval gate: excludes tutor1 enrollmentComplete=false, tutor3 searchable=false)', async () => {
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
