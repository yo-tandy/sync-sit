import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedStudyContactRequest, type SeedData } from '../../setup/seed.js';

describe('respondToTutorContactRequest', () => {
  let seed: SeedData;
  let tutor2Token: string;
  let tutor3Token: string; // a different tutor (wrong-owner cases)

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    tutor2Token = await getIdToken(seed.tutor2.uid);
    tutor3Token = await getIdToken(seed.tutor3.uid);
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
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [],
    });
  });

  async function seedPending(): Promise<string> {
    return seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
    });
  }

  it('accept flips status, unlocks approvedFamilies, and notifies the parents', async () => {
    const requestId = await seedPending();
    const res = await callFunction<{ success: boolean }>(
      'respondToTutorContactRequest',
      { requestId, action: 'accept' },
      tutor2Token
    );
    expect(res.success).toBe(true);

    const db = getDb();
    const doc = (await db.collection('studyContactRequests').doc(requestId).get()).data()!;
    expect(doc.status).toBe('accepted');
    expect(doc.respondedAt).toBeTruthy();

    const tutorDoc = (await db.collection('users').doc(seed.tutor2.uid).get()).data()!;
    expect(tutorDoc.profiles.tutor.approvedFamilies).toContain(seed.family1Id);

    // Both parents in family1 get a study_request_accepted notification.
    const notifs = await db.collection('notifications')
      .where('type', '==', 'study_request_accepted')
      .get();
    const recipients = notifs.docs.map((d) => d.data().recipientUserId);
    expect(recipients).toContain(seed.parent1.uid);
    expect(recipients).toContain(seed.parent2.uid);
  });

  it('decline flips status only and does not unlock approvedFamilies', async () => {
    const requestId = await seedPending();
    await callFunction('respondToTutorContactRequest', { requestId, action: 'decline' }, tutor2Token);

    const db = getDb();
    const doc = (await db.collection('studyContactRequests').doc(requestId).get()).data()!;
    expect(doc.status).toBe('declined');

    const tutorDoc = (await db.collection('users').doc(seed.tutor2.uid).get()).data()!;
    expect(tutorDoc.profiles.tutor.approvedFamilies || []).not.toContain(seed.family1Id);

    const notifs = await db.collection('notifications')
      .where('type', '==', 'study_request_declined')
      .get();
    expect(notifs.size).toBeGreaterThan(0);
  });

  it('rejects a response from a tutor who does not own the request (permission-denied)', async () => {
    const requestId = await seedPending();
    await expect(
      callFunction('respondToTutorContactRequest', { requestId, action: 'accept' }, tutor3Token)
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a second response after accept (failed-precondition)', async () => {
    const requestId = await seedPending();
    await callFunction('respondToTutorContactRequest', { requestId, action: 'accept' }, tutor2Token);
    await expect(
      callFunction('respondToTutorContactRequest', { requestId, action: 'decline' }, tutor2Token)
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a second response after decline (failed-precondition)', async () => {
    const requestId = await seedPending();
    await callFunction('respondToTutorContactRequest', { requestId, action: 'decline' }, tutor2Token);
    await expect(
      callFunction('respondToTutorContactRequest', { requestId, action: 'accept' }, tutor2Token)
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects an unknown requestId with not-found', async () => {
    await expect(
      callFunction('respondToTutorContactRequest', { requestId: 'does-not-exist', action: 'accept' }, tutor2Token)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects unauthenticated calls', async () => {
    const requestId = await seedPending();
    await expect(
      callFunction('respondToTutorContactRequest', { requestId, action: 'accept' })
    ).rejects.toThrow();
  });
});
