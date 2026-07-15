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
    const refs = await db.collection('references').get();
    await Promise.all(refs.docs.map((d) => d.ref.delete()));
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

  it('accept flips status to approved and stamps approvedAt', async () => {
    const referenceId = await seedPrivateEndorsement(seed.tutor2.uid);
    const res = await callFunction<{ ok: boolean }>(
      'respondToTutorEndorsement',
      { referenceId, action: 'accept' },
      tutor2Token
    );
    expect(res.ok).toBe(true);
    const doc = (await getDb().collection('references').doc(referenceId).get()).data()!;
    expect(doc.status).toBe('approved');
    expect(doc.approvedAt).toBeTruthy();
  });

  it('dismiss flips status to removed', async () => {
    const referenceId = await seedPrivateEndorsement(seed.tutor2.uid);
    await callFunction('respondToTutorEndorsement', { referenceId, action: 'dismiss' }, tutor2Token);
    const doc = (await getDb().collection('references').doc(referenceId).get()).data()!;
    expect(doc.status).toBe('removed');
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
});
