import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedStudyContactRequest, type SeedData } from '../../setup/seed.js';

const PARIS_CENTER = { lat: 48.8566, lng: 2.3522 };

interface SearchResult {
  uid: string;
  requestStatus: string;
}

describe('cancelContactRequest', () => {
  let seed: SeedData;
  let parent1Token: string; // verified family1 (owns the requests below)
  let otherFamilyToken: string; // parent in a DIFFERENT family (wrong-family case)
  let tutor2Token: string; // a non-parent caller

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    otherFamilyToken = await getIdToken(seed.parent3.uid); // family2 (Martin)
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
  });

  it('cancels a pending request the family owns (status → cancelled, stamps cancelledAt) + notifies the tutor', async () => {
    const requestId = await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
    });

    const res = await callFunction<{ success: boolean }>(
      'cancelContactRequest',
      { requestId },
      parent1Token,
    );
    expect(res.success).toBe(true);

    const db = getDb();
    const doc = (await db.collection('studyContactRequests').doc(requestId).get()).data()!;
    expect(doc.status).toBe('cancelled');
    expect(doc.cancelledAt).toBeTruthy();
    expect(doc.updatedAt).toBeTruthy();

    // Tutor is notified of the withdrawal.
    const notifs = await db.collection('notifications')
      .where('recipientUserId', '==', seed.tutor2.uid)
      .where('type', '==', 'study_contact_request_cancelled')
      .get();
    expect(notifs.size).toBe(1);
    expect(notifs.docs[0].data().data.requestId).toBe(requestId);
  });

  it('rejects unauthenticated calls', async () => {
    const requestId = await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
    });
    await expect(
      callFunction('cancelContactRequest', { requestId }),
    ).rejects.toThrow();
  });

  it('rejects a non-parent caller with permission-denied', async () => {
    const requestId = await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
    });
    await expect(
      callFunction('cancelContactRequest', { requestId }, tutor2Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects cancelling another family\'s request with permission-denied', async () => {
    const requestId = await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
    });
    await expect(
      callFunction('cancelContactRequest', { requestId }, otherFamilyToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an unknown requestId with not-found', async () => {
    await expect(
      callFunction('cancelContactRequest', { requestId: 'does-not-exist' }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects cancelling an accepted request (failed-precondition)', async () => {
    const requestId = await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'accepted',
    });
    await expect(
      callFunction('cancelContactRequest', { requestId }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects cancelling a declined request (failed-precondition)', async () => {
    const requestId = await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'declined',
    });
    await expect(
      callFunction('cancelContactRequest', { requestId }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects cancelling an already-cancelled request (failed-precondition)', async () => {
    const requestId = await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'cancelled',
    });
    await expect(
      callFunction('cancelContactRequest', { requestId }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  // ── Cooldown pin: cancelling does NOT start the 7-day decline cooldown ──
  it('lets the family re-send immediately after cancelling (no cooldown, unlike decline)', async () => {
    const requestId = await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
    });
    await callFunction('cancelContactRequest', { requestId }, parent1Token);

    // No cooldown wait — a fresh request must succeed right away.
    const resend = await callFunction<{ requestId: string }>(
      'sendTutorContactRequest',
      { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e' },
      parent1Token,
    );
    expect(resend.requestId).toBeTruthy();
    expect(resend.requestId).not.toBe(requestId);
  });

  // ── searchTutors surfaces a cancelled request as 'none' (family may re-request) ──
  it('searchTutors maps a cancelled request to requestStatus "none"', async () => {
    await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'cancelled',
    });
    const result = await callFunction<{ results: SearchResult[] }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: PARIS_CENTER },
      parent1Token,
    );
    const t2 = result.results.find((r) => r.uid === seed.tutor2.uid);
    expect(t2?.requestStatus).toBe('none');
  });
});
