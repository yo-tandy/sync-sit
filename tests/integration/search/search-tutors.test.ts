import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

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
});
