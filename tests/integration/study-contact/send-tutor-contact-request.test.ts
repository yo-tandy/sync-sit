import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedStudyContactRequest, type SeedData } from '../../setup/seed.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('sendTutorContactRequest', () => {
  let seed: SeedData;
  let parent1Token: string; // verified family1
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
    const reqs = await db.collection('studyContactRequests').get();
    await Promise.all(reqs.docs.map((d) => d.ref.delete()));
    const notifs = await db.collection('notifications').get();
    await Promise.all(notifs.docs.map((d) => d.ref.delete()));
    // Reset tutor2's server-owned approval list.
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [],
    });
  });

  it('creates a pending request with denormalized display fields + a tutor notification', async () => {
    const result = await callFunction<{ requestId: string }>(
      'sendTutorContactRequest',
      { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e', message: 'Hello, we need math help.' },
      parent1Token
    );
    expect(result.requestId).toBeTruthy();

    const db = getDb();
    const doc = (await db.collection('studyContactRequests').doc(result.requestId).get()).data()!;
    expect(doc.tutorUserId).toBe(seed.tutor2.uid);
    expect(doc.familyId).toBe(seed.family1Id);
    expect(doc.familyName).toBe('Dupont');
    expect(doc.parentName).toBe('Marie Dupont');
    // parentName's owner, so the identity-correction fan-out can reach the
    // snapshot (issue #273).
    expect(doc.parentUserId).toBe(seed.parent1.uid);
    expect(doc.tutorName).toBe('Yael Cohen');
    expect(doc.createdByUserId).toBe(seed.parent1.uid);
    expect(doc.subject).toBe('math');
    expect(doc.level).toBe('6e');
    expect(doc.message).toBe('Hello, we need math help.');
    expect(doc.status).toBe('pending');

    const notifs = await db.collection('notifications')
      .where('recipientUserId', '==', seed.tutor2.uid)
      .where('type', '==', 'study_contact_request')
      .get();
    expect(notifs.size).toBe(1);
    expect(notifs.docs[0].data().data.requestId).toBe(result.requestId);
  });

  it('rejects unauthenticated calls', async () => {
    await expect(
      callFunction('sendTutorContactRequest', { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e' })
    ).rejects.toThrow();
  });

  it('rejects a non-parent caller with permission-denied', async () => {
    await expect(
      callFunction('sendTutorContactRequest', { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e' }, tutor2Token)
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an unverified family with permission-denied', async () => {
    const parent3Token = await getIdToken(seed.parent3.uid);
    await expect(
      callFunction('sendTutorContactRequest', { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e' }, parent3Token)
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a self-directed request with invalid-argument', async () => {
    await expect(
      callFunction('sendTutorContactRequest', { tutorUserId: seed.parent1.uid, subject: 'math', level: '6e' }, parent1Token)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a tutor who has not completed enrollment (failed-precondition)', async () => {
    // tutor1 is active but enrollmentComplete=false.
    await expect(
      callFunction('sendTutorContactRequest', { tutorUserId: seed.tutor1.uid, subject: 'math', level: '6e' }, parent1Token)
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects an unknown tutor with not-found', async () => {
    await expect(
      callFunction('sendTutorContactRequest', { tutorUserId: 'no-such-tutor', subject: 'math', level: '6e' }, parent1Token)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a subject/level the tutor does not offer (failed-precondition)', async () => {
    // tutor2 offers english only at 6e, not 4e.
    await expect(
      callFunction('sendTutorContactRequest', { tutorUserId: seed.tutor2.uid, subject: 'english', level: '4e' }, parent1Token)
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a duplicate pending request with already-exists', async () => {
    await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
    });
    await expect(
      callFunction('sendTutorContactRequest', { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e' }, parent1Token)
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  it('rejects when the family is already approved (failed-precondition)', async () => {
    await getDb().collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
    });
    await expect(
      callFunction('sendTutorContactRequest', { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e' }, parent1Token)
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a re-request within 7 days of a decline (resource-exhausted)', async () => {
    await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'declined',
      createdAt: new Date(Date.now() - 3 * DAY_MS),
    });
    await expect(
      callFunction('sendTutorContactRequest', { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e' }, parent1Token)
    ).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' });
  });

  it('allows a re-request once the 7-day cooldown has passed', async () => {
    await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'declined',
      createdAt: new Date(Date.now() - 8 * DAY_MS),
    });
    const result = await callFunction<{ requestId: string }>(
      'sendTutorContactRequest',
      { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e' },
      parent1Token
    );
    expect(result.requestId).toBeTruthy();
  });

  it('rejects an oversized message with invalid-argument', async () => {
    await expect(
      callFunction(
        'sendTutorContactRequest',
        { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e', message: 'x'.repeat(1001) },
        parent1Token
      )
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
