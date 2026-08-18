import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const PARIS_CENTER = { lat: 48.8566, lng: 2.3522 };

interface SearchResult {
  uid: string;
  endorsementCount: number;
}

describe('respondToTutorEndorsement', () => {
  let seed: SeedData;
  let tutor2Token: string;
  let tutor3Token: string; // wrong-owner cases
  let parent1Token: string; // verified family — for the cross-callable search

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    tutor2Token = await getIdToken(seed.tutor2.uid);
    tutor3Token = await getIdToken(seed.tutor3.uid);
    parent1Token = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    for (const coll of ['references', 'notifications']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    // Reset the server-owned counter — accept increments it and it would
    // otherwise accumulate across tests.
    await Promise.all(
      [seed.tutor2.uid, seed.tutor3.uid].map((uid) =>
        db.collection('users').doc(uid).update({ 'profiles.tutor.endorsementCount': 0 }),
      ),
    );
    // Reset the references pref — the gating test flips it off for parent1.
    await Promise.all(
      [seed.parent1.uid, seed.parent2.uid].map((uid) =>
        db.collection('users').doc(uid).update({
          'notifPrefs.references': { push: true, email: true },
        }),
      ),
    );
  });

  // Seed a private tutor endorsement directly (keyed by tutorUserId + appSource).
  async function seedPrivateEndorsement(tutorUserId: string): Promise<string> {
    const db = getDb();
    const ref = db.collection('references').doc();
    await ref.set({
      referenceId: ref.id,
      type: 'family_submitted',
      appSource: 'study',
      status: 'private',
      tutorUserId,
      submittedByUserId: seed.parent1.uid,
      submittedByFamilyId: seed.family1Id,
      submittedByName: 'Marie Dupont',
      refName: 'Marie Dupont',
      referenceText: 'Great tutor, highly recommended.',
      subject: 'math',
      isEjmFamily: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return ref.id;
  }

  it('accept flips status to approved, stamps approvedAt, and increments the tutor endorsementCount', async () => {
    const referenceId = await seedPrivateEndorsement(seed.tutor2.uid);
    const res = await callFunction<{ ok: boolean }>(
      'respondToTutorEndorsement',
      { referenceId, action: 'accept' },
      tutor2Token
    );
    expect(res.ok).toBe(true);
    const db = getDb();
    const doc = (await db.collection('references').doc(referenceId).get()).data()!;
    expect(doc.status).toBe('approved');
    expect(doc.approvedAt).toBeTruthy();
    // Server-owned counter incremented from the beforeEach baseline of 0.
    const tutorDoc = (await db.collection('users').doc(seed.tutor2.uid).get()).data()!;
    expect(tutorDoc.profiles.tutor.endorsementCount).toBe(1);
  });

  it('dismiss flips status to removed and does NOT change the endorsementCount', async () => {
    const referenceId = await seedPrivateEndorsement(seed.tutor2.uid);
    await callFunction('respondToTutorEndorsement', { referenceId, action: 'dismiss' }, tutor2Token);
    const db = getDb();
    const doc = (await db.collection('references').doc(referenceId).get()).data()!;
    expect(doc.status).toBe('removed');
    const tutorDoc = (await db.collection('users').doc(seed.tutor2.uid).get()).data()!;
    expect(tutorDoc.profiles.tutor.endorsementCount).toBe(0);
  });

  // ── Submitter-outcome notifications (issue #168 Phase 0) ──

  it('accept notifies every parent of the submitting family (tutor_endorsement_published, tutor first name in body)', async () => {
    const referenceId = await seedPrivateEndorsement(seed.tutor2.uid);
    await callFunction('respondToTutorEndorsement', { referenceId, action: 'accept' }, tutor2Token);

    const db = getDb();
    for (const parentUid of [seed.parent1.uid, seed.parent2.uid]) {
      const snap = await db.collection('notifications')
        .where('recipientUserId', '==', parentUid).get();
      const doc = snap.docs.find((d) => d.data().type === 'tutor_endorsement_published');
      expect(doc).toBeTruthy();
      expect(doc!.data().body).toContain('Yael'); // tutor2's first name
      expect(doc!.data().body).toContain('now visible');
      expect(doc!.data().emailSent).toBe(true); // references.email pref is on
      expect(doc!.data().data.referenceId).toBe(referenceId);
    }
  });

  it('dismiss notifies the submitter neutrally (tutor_endorsement_declined, "was not published")', async () => {
    const referenceId = await seedPrivateEndorsement(seed.tutor2.uid);
    await callFunction('respondToTutorEndorsement', { referenceId, action: 'dismiss' }, tutor2Token);

    const db = getDb();
    const snap = await db.collection('notifications')
      .where('recipientUserId', '==', seed.parent1.uid).get();
    const doc = snap.docs.find((d) => d.data().type === 'tutor_endorsement_declined');
    expect(doc).toBeTruthy();
    expect(doc!.data().body).toContain('was not published');
    // Neutral copy: never says the tutor rejected/declined it.
    expect(doc!.data().body.toLowerCase()).not.toContain('reject');
  });

  it('respects the references email pref when notifying (emailSent false when opted out)', async () => {
    const db = getDb();
    await db.collection('users').doc(seed.parent1.uid).update({
      'notifPrefs.references': { push: false, email: false },
    });
    const referenceId = await seedPrivateEndorsement(seed.tutor2.uid);
    await callFunction('respondToTutorEndorsement', { referenceId, action: 'accept' }, tutor2Token);

    const p1 = await db.collection('notifications')
      .where('recipientUserId', '==', seed.parent1.uid).get();
    const p1doc = p1.docs.find((d) => d.data().type === 'tutor_endorsement_published');
    // In-app doc still written, but the email channel respected the opt-out.
    expect(p1doc).toBeTruthy();
    expect(p1doc!.data().emailSent).toBe(false);
    // parent2 kept the default and still gets the email channel.
    const p2 = await db.collection('notifications')
      .where('recipientUserId', '==', seed.parent2.uid).get();
    const p2doc = p2.docs.find((d) => d.data().type === 'tutor_endorsement_published');
    expect(p2doc!.data().emailSent).toBe(true);
  });

  it('rejects a response from a tutor who is not the endorsed one (permission-denied)', async () => {
    const referenceId = await seedPrivateEndorsement(seed.tutor2.uid);
    await expect(
      callFunction('respondToTutorEndorsement', { referenceId, action: 'accept' }, tutor3Token)
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a second response after the first (failed-precondition)', async () => {
    const referenceId = await seedPrivateEndorsement(seed.tutor2.uid);
    await callFunction('respondToTutorEndorsement', { referenceId, action: 'accept' }, tutor2Token);
    await expect(
      callFunction('respondToTutorEndorsement', { referenceId, action: 'dismiss' }, tutor2Token)
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects an unknown referenceId (not-found)', async () => {
    await expect(
      callFunction('respondToTutorEndorsement', { referenceId: 'does-not-exist', action: 'accept' }, tutor2Token)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('searchTutors counts the endorsement only after acceptance (0 while private, 1 after accept)', async () => {
    const referenceId = await seedPrivateEndorsement(seed.tutor2.uid);

    const before = await callFunction<{ results: SearchResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: PARIS_CENTER },
      parent1Token
    );
    expect(before.results.find((r) => r.uid === seed.tutor2.uid)?.endorsementCount).toBe(0);

    await callFunction('respondToTutorEndorsement', { referenceId, action: 'accept' }, tutor2Token);

    const after = await callFunction<{ results: SearchResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: PARIS_CENTER },
      parent1Token
    );
    expect(after.results.find((r) => r.uid === seed.tutor2.uid)?.endorsementCount).toBe(1);
  });

  // Proves the per-search references SCAN is gone: searchTutors reads the
  // denormalized counter, so emptying the references collection out-of-band
  // AFTER acceptance must not change the reported count.
  it('searchTutors reports the endorsementCount from the counter even when the references collection is emptied', async () => {
    const referenceId = await seedPrivateEndorsement(seed.tutor2.uid);
    await callFunction('respondToTutorEndorsement', { referenceId, action: 'accept' }, tutor2Token);

    // Delete every reference doc directly — if search still scanned them, the
    // count would drop to 0.
    const db = getDb();
    const refs = await db.collection('references').get();
    await Promise.all(refs.docs.map((d) => d.ref.delete()));

    const result = await callFunction<{ results: SearchResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: PARIS_CENTER },
      parent1Token
    );
    expect(result.results.find((r) => r.uid === seed.tutor2.uid)?.endorsementCount).toBe(1);
  });
});
