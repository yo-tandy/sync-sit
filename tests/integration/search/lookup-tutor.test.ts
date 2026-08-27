import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

interface LookupResult {
  uid: string;
  firstName: string;
  lastName: string;
  requestStatus: 'none' | 'pending' | 'accepted' | 'incoming' | 'declined';
  subjects: { subject: string; levels: string[] }[];
}

/**
 * lookupTutor (issue #235, parity A2) — sit's lookupBabysitter ported to
 * study. Parent-only, searchable-gated, name-substring or exact
 * email/ejemEmail, per-pair request status with searchTutors' 'incoming'
 * idiom, capped at 10. Deliberately NO family-verification gate (sit parity):
 * results are display-only and sendTutorContactRequest enforces
 * isFullyVerified itself.
 */
describe('lookupTutor', () => {
  let seed: SeedData;
  let parentToken: string;
  let tutorToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parentToken = await getIdToken(seed.parent1.uid);
    tutorToken = await getIdToken(seed.tutor2.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const reqs = await db.collection('studyContactRequests').get();
    await Promise.all(reqs.docs.map((d) => d.ref.delete()));
  });

  it('rejects unauthenticated calls', async () => {
    await expect(callFunction('lookupTutor', { query: 'yael' })).rejects.toThrow();
  });

  it('rejects a non-parent caller with permission-denied', async () => {
    try {
      await callFunction('lookupTutor', { query: 'yael' }, tutorToken);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('PERMISSION_DENIED');
    }
  });

  it('rejects a sub-2-character query', async () => {
    try {
      await callFunction('lookupTutor', { query: 'y' }, parentToken);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('INVALID_ARGUMENT');
    }
  });

  it('finds a searchable tutor by name substring, without contact fields', async () => {
    const res = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'yae' }, parentToken,
    );
    expect(res.results.map((r) => r.uid)).toContain(seed.tutor2.uid);
    const hit = res.results.find((r) => r.uid === seed.tutor2.uid)!;
    expect(hit.firstName).toBe('Yael');
    expect(hit.requestStatus).toBe('none');
    expect(hit.subjects.map((s) => s.subject).sort()).toEqual(['english', 'math']);
    // The two-stage model: no contact reveal from lookup, ever.
    const raw = hit as unknown as Record<string, unknown>;
    expect(raw.contactEmail).toBeUndefined();
    expect(raw.contactPhone).toBeUndefined();
    expect(raw.email).toBeUndefined();
  });

  it('does NOT match a name fragment as an email (email matches are exact-only)', async () => {
    const res = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'yael.cohen@ejm' }, parentToken,
    );
    // Partial email is neither a name substring nor an exact email.
    expect(res.results.map((r) => r.uid)).not.toContain(seed.tutor2.uid);
  });

  it('finds a tutor by exact login email', async () => {
    const res = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'yael.cohen@ejm.org' }, parentToken,
    );
    expect(res.results.map((r) => r.uid)).toContain(seed.tutor2.uid);
  });

  it('finds a tutor by exact ejemEmail (root-first precedence, issue #203)', async () => {
    // Give tutor2 a ROOT ejemEmail different from the profile copy: getEjemEmail
    // must read root first, so only the root value resolves.
    await getDb().collection('users').doc(seed.tutor2.uid)
      .update({ ejemEmail: 'yael.root@ejm.org' });
    try {
      const byRoot = await callFunction<{ results: LookupResult[] }>(
        'lookupTutor', { query: 'yael.root@ejm.org' }, parentToken,
      );
      expect(byRoot.results.map((r) => r.uid)).toContain(seed.tutor2.uid);
    } finally {
      await getDb().collection('users').doc(seed.tutor2.uid)
        .update({ ejemEmail: FieldValue.delete() });
    }
  });

  it('never resolves a non-searchable tutor, even by exact email', async () => {
    // tutor3 (Daniel) is enrolled with identical offerings but searchable:false.
    const res = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'daniel.levy@ejm.org' }, parentToken,
    );
    expect(res.results).toHaveLength(0);
  });

  it('maps a family-initiated pending request to pending', async () => {
    await getDb().collection('studyContactRequests').add({
      familyId: seed.family1Id, tutorUserId: seed.tutor2.uid,
      status: 'pending', initiatedBy: 'family', subject: 'math', level: '6e',
      createdAt: new Date(),
    });
    const res = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'yael' }, parentToken,
    );
    expect(res.results.find((r) => r.uid === seed.tutor2.uid)!.requestStatus).toBe('pending');
  });

  it("maps a TUTOR-initiated pending to 'incoming', never 'pending' (searchTutors' idiom)", async () => {
    await getDb().collection('studyContactRequests').add({
      familyId: seed.family1Id, tutorUserId: seed.tutor2.uid,
      status: 'pending', initiatedBy: 'tutor', subject: 'math', level: '6e',
      createdAt: new Date(),
    });
    const res = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'yael' }, parentToken,
    );
    expect(res.results.find((r) => r.uid === seed.tutor2.uid)!.requestStatus).toBe('incoming');
  });

  it('maps accepted to accepted, and a declined pair to declined (searchTutors parity)', async () => {
    const ref = await getDb().collection('studyContactRequests').add({
      familyId: seed.family1Id, tutorUserId: seed.tutor2.uid,
      status: 'accepted', initiatedBy: 'family', subject: 'math', level: '6e',
      createdAt: new Date(),
    });
    let res = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'yael' }, parentToken,
    );
    expect(res.results.find((r) => r.uid === seed.tutor2.uid)!.requestStatus).toBe('accepted');

    await ref.update({ status: 'declined' });
    res = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'yael' }, parentToken,
    );
    // 'declined', not 'none' -- the CTA must promise a RETRY (the cooldown
    // may reject it), exactly as searchTutors surfaces the same pair.
    expect(res.results.find((r) => r.uid === seed.tutor2.uid)!.requestStatus).toBe('declined');
  });

  it('resolves multiple requests per pair by createdAt: the LATEST wins', async () => {
    const db = getDb();
    // Older declined, newer pending -> pending (a rank-based map would need
    // pending to unconditionally outrank; recency is the searchTutors rule).
    await db.collection('studyContactRequests').add({
      familyId: seed.family1Id, tutorUserId: seed.tutor2.uid,
      status: 'declined', initiatedBy: 'family', subject: 'math', level: '6e',
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    await db.collection('studyContactRequests').add({
      familyId: seed.family1Id, tutorUserId: seed.tutor2.uid,
      status: 'pending', initiatedBy: 'family', subject: 'math', level: '6e',
      createdAt: new Date(),
    });
    const res = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'yael' }, parentToken,
    );
    expect(res.results.find((r) => r.uid === seed.tutor2.uid)!.requestStatus).toBe('pending');
  });

  it('another family sees requestStatus none for the same tutor', async () => {
    await getDb().collection('studyContactRequests').add({
      familyId: seed.family1Id, tutorUserId: seed.tutor2.uid,
      status: 'pending', initiatedBy: 'family', subject: 'math', level: '6e',
      createdAt: new Date(),
    });
    // parent2 shares family1 -- parent3 (family2, Martin) is the other family.
    const parent3Token = await getIdToken(seed.parent3.uid);
    const res = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'yael' }, parent3Token,
    );
    expect(res.results.find((r) => r.uid === seed.tutor2.uid)!.requestStatus).toBe('none');
  });

  it('an UNVERIFIED family still gets results -- accepted risk, sit parity (no verification gate)', async () => {
    // parent3's family (Martin) is NOT fully verified. searchTutors rejects
    // it; lookup deliberately does not -- the payload is display-only and
    // sendTutorContactRequest enforces isFullyVerified itself. This pin
    // makes the intent legible: if someone later adds a gate here, they are
    // reversing a stated decision, not fixing an oversight.
    const parent3Token = await getIdToken(seed.parent3.uid);
    const res = await callFunction<{ results: LookupResult[] }>(
      'lookupTutor', { query: 'yael' }, parent3Token,
    );
    expect(res.results.map((r) => r.uid)).toContain(seed.tutor2.uid);
  });

  it('never resolves an enrollmentComplete=false tutor, even searchable by exact email', async () => {
    const db = getDb();
    const ref = db.collection('users').doc('lookup-unenrolled-1');
    await ref.set({
      uid: ref.id, email: 'unenrolled@ejm-test.org', status: 'active',
      firstName: 'Una', lastName: 'Enrolled',
      profiles: { tutor: {
        enrollmentComplete: false, ejemEmail: 'unenrolled@ejm-test.org',
        searchable: true, classLevel: 'L1', languages: ['French'],
        subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
      } },
    });
    try {
      const res = await callFunction<{ results: LookupResult[] }>(
        'lookupTutor', { query: 'unenrolled@ejm-test.org' }, parentToken,
      );
      expect(res.results).toHaveLength(0);
    } finally {
      await ref.delete();
    }
  });

  it('writes a lookup_tutor audit entry with counts, never the query text', async () => {
    await callFunction('lookupTutor', { query: 'yael' }, parentToken);
    const logs = await getDb().collection('auditLogs')
      .where('action', '==', 'lookup_tutor').get();
    expect(logs.empty).toBe(false);
    const entries = logs.docs.map((d) => d.data());
    expect(entries.some((e) => (e.details as { queryLength?: number })?.queryLength === 4)).toBe(true);
    // No entry ever carries the raw query -- it may be an email address.
    expect(JSON.stringify(entries)).not.toContain('yael');
  });

  it('throttles per uid: a spent window rejects, a stale window admits (PR #254 round 2)', async () => {
    const db = getDb();
    const counterRef = db.collection('verificationSendCounters').doc(`lookup:${seed.parent1.uid}`);
    // Spent live window -> resource-exhausted, and the counter is NOT bumped.
    await counterRef.set({ key: `lookup:${seed.parent1.uid}`, kind: 'lookup', count: 60, windowStart: new Date() });
    try {
      try {
        await callFunction('lookupTutor', { query: 'yael' }, parentToken);
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('RESOURCE_EXHAUSTED');
      }
      expect((await counterRef.get()).data()!.count).toBe(60);

      // Expired window -> admitted, counter restarts at 1.
      await counterRef.set({
        key: `lookup:${seed.parent1.uid}`, kind: 'lookup', count: 60,
        windowStart: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });
      const res = await callFunction<{ results: LookupResult[] }>(
        'lookupTutor', { query: 'yael' }, parentToken,
      );
      expect(res.results.map((r) => r.uid)).toContain(seed.tutor2.uid);
      expect((await counterRef.get()).data()!.count).toBe(1);
    } finally {
      await counterRef.delete();
    }
  });

  it('caps results at 10', async () => {
    const db = getDb();
    const created: string[] = [];
    for (let i = 0; i < 12; i++) {
      const ref = db.collection('users').doc(`lookup-cap-${i}`);
      created.push(ref.id);
      await ref.set({
        uid: ref.id, email: `capmatch${i}@ejm-test.org`, status: 'active',
        firstName: 'Capmatch', lastName: `Tutor${i}`,
        profiles: { tutor: {
          enrollmentComplete: true, ejemEmail: `capmatch${i}@ejm-test.org`,
          searchable: true, classLevel: 'L1', languages: ['French'],
          subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
        } },
      });
    }
    try {
      const res = await callFunction<{ results: LookupResult[] }>(
        'lookupTutor', { query: 'capmatch' }, parentToken,
      );
      expect(res.results).toHaveLength(10);
    } finally {
      await Promise.all(created.map((id) => db.collection('users').doc(id).delete()));
    }
  });
});
