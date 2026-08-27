import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedStudyContactRequest, type SeedData } from '../../setup/seed.js';

/**
 * Direct tutor lookup by personal code (issue #235, parity A2):
 * getTutorPersonalCode (mint-on-first-read, tutor-only) and lookupTutor
 * (verified-parent-only, uniform not-found, searchable RE-CHECKED at lookup
 * time — the sit fix/lookup-babysitter-searchable lesson).
 *
 * Seed cast: tutor2 (Yael) is enrolled + searchable; tutor3 (Daniel) is
 * enrolled but NOT searchable — the clean searchable-gate negative; tutor1 is
 * active but enrollmentComplete=false; parent1 belongs to the verified
 * family1, parent3 to the unverified family2.
 */
describe('personal-code lookup (issue #235)', () => {
  let seed: SeedData;
  let parent1Token: string;
  let parent3Token: string;
  let tutor1Token: string;
  let tutor2Token: string;
  let tutor3Token: string;
  let tutor2Code: string;

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
    tutor1Token = await getIdToken(seed.tutor1.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);
    tutor3Token = await getIdToken(seed.tutor3.uid);
    // Mint tutor2's code once up front; most lookup cases resolve it.
    const minted = await callFunction<{ code: string }>('getTutorPersonalCode', {}, tutor2Token);
    tutor2Code = minted.code;
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
      'profiles.tutor.approvedFamilies': [],
    });
  });

  // ── getTutorPersonalCode ──

  it('mints an 8-hex-char code, persists it on the profile, and audits the mint', async () => {
    expect(tutor2Code).toMatch(/^[0-9A-F]{8}$/);

    const db = getDb();
    const doc = (await db.collection('users').doc(seed.tutor2.uid).get()).data()!;
    expect(doc.profiles.tutor.personalCode).toBe(tutor2Code);

    const logs = await db.collection('auditLogs')
      .where('adminUserId', '==', seed.tutor2.uid)
      .where('action', '==', 'tutor_personal_code_generated')
      .get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().details.code).toBe(tutor2Code);
  });

  it('is idempotent: a second call returns the SAME code, and mints no second audit row', async () => {
    const again = await callFunction<{ code: string }>('getTutorPersonalCode', {}, tutor2Token);
    expect(again.code).toBe(tutor2Code);

    const logs = await getDb().collection('auditLogs')
      .where('adminUserId', '==', seed.tutor2.uid)
      .where('action', '==', 'tutor_personal_code_generated')
      .get();
    expect(logs.size).toBe(1);
  });

  it('mints for a NOT-searchable tutor too — the gate lives at lookup, not at mint', async () => {
    const minted = await callFunction<{ code: string }>('getTutorPersonalCode', {}, tutor3Token);
    expect(minted.code).toMatch(/^[0-9A-F]{8}$/);
    expect(minted.code).not.toBe(tutor2Code);
  });

  it('rejects unauthenticated calls', async () => {
    await expect(callFunction('getTutorPersonalCode', {})).rejects.toThrow();
  });

  it('rejects a non-tutor caller with permission-denied', async () => {
    await expect(
      callFunction('getTutorPersonalCode', {}, parent1Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an unenrolled tutor with failed-precondition', async () => {
    await expect(
      callFunction('getTutorPersonalCode', {}, tutor1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  // ── lookupTutor: resolution ──

  it('resolves a code to the tutor card: full offerings, no matched subject, no contact fields', async () => {
    const res = await callFunction<{ result: LookupResult }>(
      'lookupTutor', { code: tutor2Code }, parent1Token,
    );
    expect(res.result.uid).toBe(seed.tutor2.uid);
    expect(res.result.firstName).toBe('Yael');
    // The FULL offerings ship — the family picks subject/level client-side
    // before minting the normal contact request.
    expect(res.result.subjects).toEqual([
      { subject: 'math', levels: ['6e', '5e', '4e'], rate: 25 },
      { subject: 'english', levels: ['6e'], rate: 22 },
    ]);
    expect(res.result.requestStatus).toBe('none');
    // Not approved: contact fields must be absent.
    expect(res.result.contactEmail).toBeUndefined();
    expect(res.result.contactPhone).toBeUndefined();

    const logs = await getDb().collection('auditLogs')
      .where('adminUserId', '==', seed.parent1.uid)
      .where('action', '==', 'tutor_code_lookup')
      .get();
    const hit = logs.docs.find((d) => d.data().details.found === true);
    expect(hit).toBeTruthy();
    expect(hit!.data().details.tutorUserId).toBe(seed.tutor2.uid);
  });

  it('normalizes human relay noise: lowercase, spaces and dashes resolve', async () => {
    const noisy = `${tutor2Code.slice(0, 4).toLowerCase()}-${tutor2Code.slice(4).toLowerCase()} `;
    const res = await callFunction<{ result: LookupResult }>(
      'lookupTutor', { code: noisy }, parent1Token,
    );
    expect(res.result.uid).toBe(seed.tutor2.uid);
  });

  it('projects contact fields once the family is approved', async () => {
    await getDb().collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
    });
    const res = await callFunction<{ result: LookupResult }>(
      'lookupTutor', { code: tutor2Code }, parent1Token,
    );
    expect(res.result.contactEmail).toBe('yael.cohen@ejm.org');
  });

  it('reflects this family\'s request status (pending sent / incoming tutor-initiated)', async () => {
    await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
    });
    const sent = await callFunction<{ result: LookupResult }>(
      'lookupTutor', { code: tutor2Code }, parent1Token,
    );
    expect(sent.result.requestStatus).toBe('pending');

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
    const incoming = await callFunction<{ result: LookupResult }>(
      'lookupTutor', { code: tutor2Code }, parent1Token,
    );
    expect(incoming.result.requestStatus).toBe('incoming');
  });

  // ── lookupTutor: the searchable RE-CHECK at lookup time ──

  it('a NOT-searchable tutor\'s code does not resolve (uniform not-found)', async () => {
    // tutor3's code exists (minted above) but searchable=false.
    const db = getDb();
    const tutor3Doc = (await db.collection('users').doc(seed.tutor3.uid).get()).data()!;
    const tutor3Code = tutor3Doc.profiles.tutor.personalCode as string;
    expect(tutor3Code).toBeTruthy();

    await expect(
      callFunction('lookupTutor', { code: tutor3Code }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a tutor who toggles hidden AFTER minting stops resolving — and resumes when visible again', async () => {
    // THE load-bearing behavior (sit's fix/lookup-babysitter-searchable):
    // the gate reads the CURRENT flag, not the flag at mint time.
    const db = getDb();
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.searchable': false,
    });
    await expect(
      callFunction('lookupTutor', { code: tutor2Code }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.searchable': true,
    });
    const res = await callFunction<{ result: LookupResult }>(
      'lookupTutor', { code: tutor2Code }, parent1Token,
    );
    expect(res.result.uid).toBe(seed.tutor2.uid);
  });

  it('an ambiguous (duplicated) code fails closed as not-found', async () => {
    // Minting guards uniqueness; if the negligible race ever produced a
    // duplicate anyway, resolving to either doc could connect the family to
    // the wrong person — so it must resolve to NEITHER.
    const db = getDb();
    await db.collection('users').doc(seed.tutor3.uid).update({
      'profiles.tutor.personalCode': tutor2Code,
      'profiles.tutor.searchable': true,
    });
    try {
      await expect(
        callFunction('lookupTutor', { code: tutor2Code }, parent1Token),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      // Restore tutor3 to the seed shape (hidden, no code) for later cases.
      const { FieldValue } = await import('firebase-admin/firestore');
      await db.collection('users').doc(seed.tutor3.uid).update({
        'profiles.tutor.searchable': false,
        'profiles.tutor.personalCode': FieldValue.delete(),
      });
    }
  });

  // ── lookupTutor: caller gates + input ──

  it('rejects unauthenticated calls', async () => {
    await expect(callFunction('lookupTutor', { code: tutor2Code })).rejects.toThrow();
  });

  it('rejects a non-parent caller with permission-denied', async () => {
    await expect(
      callFunction('lookupTutor', { code: tutor2Code }, tutor2Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an unverified family with permission-denied — a code is not a verification bypass', async () => {
    await expect(
      callFunction('lookupTutor', { code: tutor2Code }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a malformed code with invalid-argument before any query runs', async () => {
    await expect(
      callFunction('lookupTutor', { code: 'not-a-code!' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('returns not-found for a well-formed unknown code, and audits the miss', async () => {
    await expect(
      callFunction('lookupTutor', { code: '00000001' }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const logs = await getDb().collection('auditLogs')
      .where('adminUserId', '==', seed.parent1.uid)
      .where('action', '==', 'tutor_code_lookup')
      .get();
    const miss = logs.docs.find(
      (d) => d.data().details.found === false && d.data().details.code === '00000001',
    );
    expect(miss).toBeTruthy();
  });
});
