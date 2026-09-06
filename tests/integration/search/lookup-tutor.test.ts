import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedStudyContactRequest, type SeedData } from '../../setup/seed.js';
import { computeEffectiveSearchable } from '@ejm/shared-core';

/**
 * Direct tutor lookup by name/email/phone (issue #437), replacing the
 * personal-code flow (issue #235): a query can match several tutors, so
 * lookupTutor returns a LIST (like sit's lookupBabysitter) rather than
 * resolving to a single card.
 *
 * Seed cast: tutor2 (Yael) is enrolled + searchable; tutor3 (Daniel) is
 * enrolled but NOT searchable — the clean searchable-gate negative, with
 * offerings deliberately identical to tutor2's; tutor1 is active but
 * enrollmentComplete=false; parent1 belongs to the verified family1, parent3
 * to the unverified family2.
 */
describe('lookupTutor — identity search (issue #437)', () => {
  let seed: SeedData;
  let parent1Token: string;
  let parent3Token: string;
  let tutor2Token: string;

  interface LookupResult {
    uid: string;
    firstName: string;
    subjects: { subject: string; levels: string[]; rate: number }[];
    requestStatus: string;
    locationPrefs: string[];
    contactEmail?: string;
    contactPhone?: string;
  }

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const reqs = await db.collection('studyContactRequests').get();
    await Promise.all(reqs.docs.map((d) => d.ref.delete()));
    // Restore the state the gate tests toggle.
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.searchable': true,
      'profiles.tutor.effectiveSearchable': computeEffectiveSearchable(
        { status: 'active' },
        { searchable: true, enrollmentComplete: true },
      ),
      'profiles.tutor.approvedFamilies': [],
    });
  });

  it('matches by partial name', async () => {
    const { results } = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'Yael' }, parent1Token,
    );
    const yael = results.find((r) => r.uid === seed.tutor2.uid);
    expect(yael).toBeDefined();
    expect(yael!.firstName).toBe('Yael');
    // The FULL offerings ship — the family picks subject/level client-side
    // before minting the normal contact request.
    expect(yael!.subjects).toEqual([
      { subject: 'math', levels: ['6e', '5e', '4e'], rate: 25 },
      { subject: 'english', levels: ['6e'], rate: 22 },
    ]);
    expect(yael!.requestStatus).toBe('none');
    expect(yael!.contactEmail).toBeUndefined();
    expect(yael!.contactPhone).toBeUndefined();
  });

  it('matches by exact email', async () => {
    const { results } = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'yael.cohen@ejm.org' }, parent1Token,
    );
    expect(results.find((r) => r.uid === seed.tutor2.uid)).toBeDefined();
  });

  it('matches by phone number in a different format than it was stored in', async () => {
    // Seeded as '+33 655667788'.
    const { results } = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: '06 55 66 77 88' }, parent1Token,
    );
    expect(results.find((r) => r.uid === seed.tutor2.uid)).toBeDefined();
  });

  it('excludes a NOT-searchable tutor even with an identical, matchable offering', async () => {
    // tutor3 has the same subjects as tutor2 and a distinct name — a plain
    // name match against tutor3 alone must come back empty.
    const { results } = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'Daniel Levy' }, parent1Token,
    );
    expect(results).toEqual([]);
  });

  it('returns multiple matches for a query that fits several tutors', async () => {
    const { results } = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'ejm.org' }, parent1Token,
    );
    // Every seeded tutor's email ends in @ejm.org, but only searchable ones
    // (tutor2) surface — tutor1 (enrollmentComplete=false) and tutor3
    // (searchable=false) must not.
    expect(results.find((r) => r.uid === seed.tutor2.uid)).toBeDefined();
    expect(results.find((r) => r.uid === seed.tutor3.uid)).toBeUndefined();
    expect(results.find((r) => r.uid === seed.tutor1.uid)).toBeUndefined();
  });

  it('projects contact fields once the family is approved', async () => {
    await getDb().collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
    });
    const { results } = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'Yael' }, parent1Token,
    );
    expect(results.find((r) => r.uid === seed.tutor2.uid)?.contactEmail).toBe('yael.cohen@ejm.org');
  });

  it('reflects this family\'s request status (pending sent / incoming tutor-initiated)', async () => {
    await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
    });
    const sent = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'Yael' }, parent1Token,
    );
    expect(sent.results.find((r) => r.uid === seed.tutor2.uid)?.requestStatus).toBe('pending');

    const db = getDb();
    const reqs = await db.collection('studyContactRequests').get();
    await Promise.all(reqs.docs.map((d) => d.ref.delete()));

    await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.tutor2.uid,
      initiatedBy: 'tutor',
      status: 'pending',
    });
    const incoming = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'Yael' }, parent1Token,
    );
    expect(incoming.results.find((r) => r.uid === seed.tutor2.uid)?.requestStatus).toBe('incoming');
  });

  it('a tutor who toggles hidden stops matching — the gate is evaluated at lookup time, not cached', async () => {
    const db = getDb();
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.searchable': false,
      'profiles.tutor.effectiveSearchable': computeEffectiveSearchable(
        { status: 'active' },
        { searchable: false, enrollmentComplete: true },
      ),
    });
    const hidden = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'Yael' }, parent1Token,
    );
    expect(hidden.results.find((r) => r.uid === seed.tutor2.uid)).toBeUndefined();
  });

  it('rejects unauthenticated calls', async () => {
    await expect(callFunction('lookupTutor', { query: 'Yael' })).rejects.toThrow();
  });

  it('rejects a non-parent caller with permission-denied', async () => {
    await expect(
      callFunction('lookupTutor', { query: 'Yael' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an unverified family with permission-denied — a lookup is not a verification bypass', async () => {
    await expect(
      callFunction('lookupTutor', { query: 'Yael' }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a query shorter than 2 characters', async () => {
    await expect(
      callFunction('lookupTutor', { query: 'Y' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('returns an empty list, not an error, for a well-formed query with no matches', async () => {
    const { results } = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'nonexistentperson' }, parent1Token,
    );
    expect(results).toEqual([]);
  });

  it('audits the query and the match count', async () => {
    await callFunction('lookupTutor', { query: 'Yael' }, parent1Token);
    const logs = await getDb().collection('auditLogs')
      .where('adminUserId', '==', seed.parent1.uid)
      .where('action', '==', 'tutor_identity_lookup')
      .get();
    const hit = logs.docs.find((d) => d.data().details.query === 'Yael');
    expect(hit).toBeTruthy();
    expect(hit!.data().details.matchCount).toBeGreaterThanOrEqual(1);
  });
});
