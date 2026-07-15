import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const VALID_TEXT = 'Yael was a fantastic tutor — patient and clear.';

describe('submitTutorEndorsement', () => {
  let seed: SeedData;
  let parent1Token: string; // family1 (approved for tutor2 below)
  let tutor2Token: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const refs = await db.collection('references').get();
    await Promise.all(refs.docs.map((d) => d.ref.delete()));
    const notifs = await db.collection('notifications').get();
    await Promise.all(notifs.docs.map((d) => d.ref.delete()));
    // Relationship gate: family1 has an accepted contact request with tutor2.
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
    });
  });

  it('writes a private, correctly-keyed endorsement (no babysitterUserId) + notifies the tutor', async () => {
    const res = await callFunction<{ referenceId: string }>(
      'submitTutorEndorsement',
      { tutorUserId: seed.tutor2.uid, referenceText: VALID_TEXT, refName: 'Marie Dupont', subject: 'math' },
      parent1Token
    );
    expect(res.referenceId).toBeTruthy();

    const db = getDb();
    const doc = (await db.collection('references').doc(res.referenceId).get()).data()!;
    expect(doc.type).toBe('family_submitted');
    expect(doc.appSource).toBe('study');
    expect(doc.status).toBe('private');
    expect(doc.tutorUserId).toBe(seed.tutor2.uid);
    expect(doc.submittedByUserId).toBe(seed.parent1.uid);
    expect(doc.submittedByFamilyId).toBe(seed.family1Id);
    expect(doc.subject).toBe('math');
    expect(doc.referenceText).toBe(VALID_TEXT);
    expect(doc.babysitterUserId).toBeUndefined();

    const notifs = await db.collection('notifications')
      .where('recipientUserId', '==', seed.tutor2.uid)
      .where('type', '==', 'tutor_endorsement_received')
      .get();
    expect(notifs.size).toBe(1);
  });

  it('rejects a family that is not approved (permission-denied)', async () => {
    await getDb().collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [],
    });
    await expect(
      callFunction(
        'submitTutorEndorsement',
        { tutorUserId: seed.tutor2.uid, referenceText: VALID_TEXT, refName: 'Marie' },
        parent1Token
      )
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a duplicate endorsement for the same tutor (already-exists)', async () => {
    await callFunction(
      'submitTutorEndorsement',
      { tutorUserId: seed.tutor2.uid, referenceText: VALID_TEXT, refName: 'Marie' },
      parent1Token
    );
    await expect(
      callFunction(
        'submitTutorEndorsement',
        { tutorUserId: seed.tutor2.uid, referenceText: VALID_TEXT, refName: 'Marie' },
        parent1Token
      )
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  it('rejects text shorter than 10 characters (invalid-argument)', async () => {
    await expect(
      callFunction(
        'submitTutorEndorsement',
        { tutorUserId: seed.tutor2.uid, referenceText: 'short', refName: 'Marie' },
        parent1Token
      )
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a self-endorsement (invalid-argument)', async () => {
    await expect(
      callFunction(
        'submitTutorEndorsement',
        { tutorUserId: seed.parent1.uid, referenceText: VALID_TEXT, refName: 'Marie' },
        parent1Token
      )
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a non-parent caller (permission-denied)', async () => {
    await expect(
      callFunction(
        'submitTutorEndorsement',
        { tutorUserId: seed.tutor2.uid, referenceText: VALID_TEXT, refName: 'X' },
        tutor2Token
      )
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects unauthenticated calls', async () => {
    await expect(
      callFunction('submitTutorEndorsement', { tutorUserId: seed.tutor2.uid, referenceText: VALID_TEXT, refName: 'X' })
    ).rejects.toThrow();
  });
});
