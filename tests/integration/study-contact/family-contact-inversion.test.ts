import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedStudyContactRequest, type SeedData } from '../../setup/seed.js';

/**
 * The study contact INVERSION (issue #207 PR4): a tutor answers a family's
 * published search, and the FAMILY accepts. These pins cover the two new
 * callables end to end, plus the two guards the inversion forces on the
 * existing ones — a tutor must not answer their own request, and a decline in
 * one direction must not silence the other.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

describe('study contact inversion', () => {
  let seed: SeedData;
  let tutorToken: string; // tutor2 — active, enrolled, offers math 6e
  let parentToken: string; // parent1 — verified family1
  let otherParentToken: string; // parent3 — a DIFFERENT family

  async function publish(overrides: Record<string, unknown> = {}): Promise<string> {
    const db = getDb();
    const ref = db.collection('publishedSearches').doc();
    await ref.set({
      id: ref.id,
      app: 'study',
      familyId: seed.family1Id,
      familyName: 'Dupont',
      areaLabel: '16e',
      subject: 'math',
      level: '6e',
      locationPrefs: ['online'],
      maxRate: 30,
      createdBy: seed.parent1.uid,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 7 * DAY_MS),
      ...overrides,
    });
    return ref.id;
  }

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    tutorToken = await getIdToken(seed.tutor2.uid);
    parentToken = await getIdToken(seed.parent1.uid);
    otherParentToken = await getIdToken(seed.parent3.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    for (const c of ['studyContactRequests', 'publishedSearches', 'notifications']) {
      const snap = await db.collection(c).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [],
    });
  });

  // ── sendFamilyContactRequest ──────────────────────────────────────────

  it('mints a pending request marked as tutor-initiated, with an unknown parent', async () => {
    const searchId = await publish();
    const res = await callFunction<{ requestId: string }>(
      'sendFamilyContactRequest',
      { publishedSearchId: searchId, message: 'I teach math at that level.' },
      tutorToken,
    );

    const doc = (await getDb().collection('studyContactRequests').doc(res.requestId).get()).data()!;
    expect(doc.initiatedBy).toBe('tutor');
    expect(doc.publishedSearchId).toBe(searchId);
    expect(doc.tutorUserId).toBe(seed.tutor2.uid);
    expect(doc.familyId).toBe(seed.family1Id);
    expect(doc.subject).toBe('math');
    expect(doc.level).toBe('6e');
    expect(doc.status).toBe('pending');
    expect(doc.message).toBe('I teach math at that level.');
    // The responding parent is unknown until they answer.
    expect(doc.parentName).toBe('');
    // Denormalized so the FAMILY's list can render without reading the tutor
    // user doc (rules forbid it).
    expect(doc.tutorName).toBe('Yael Cohen');
  });

  it('notifies the family, not the tutor', async () => {
    const searchId = await publish();
    const res = await callFunction<{ requestId: string }>(
      'sendFamilyContactRequest',
      { publishedSearchId: searchId },
      tutorToken,
    );
    const notifs = await getDb().collection('notifications')
      .where('type', '==', 'study_published_search_contact')
      .get();
    expect(notifs.size).toBeGreaterThan(0);
    const recipients = notifs.docs.map((d) => d.data().recipientUserId);
    expect(recipients).toContain(seed.parent1.uid);
    expect(recipients).not.toContain(seed.tutor2.uid);
    expect(notifs.docs[0].data().data.requestId).toBe(res.requestId);
  });

  it('rejects a caller who is not an active enrolled tutor', async () => {
    const searchId = await publish();
    await expect(
      callFunction('sendFamilyContactRequest', { publishedSearchId: searchId }, parentToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects an expired search', async () => {
    const searchId = await publish({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await expect(
      callFunction('sendFamilyContactRequest', { publishedSearchId: searchId }, tutorToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a subject/level the tutor no longer offers', async () => {
    const searchId = await publish({ subject: 'physics', level: 'Terminale' });
    await expect(
      callFunction('sendFamilyContactRequest', { publishedSearchId: searchId }, tutorToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a family that already approved this tutor (nothing to request)', async () => {
    await getDb().collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
    });
    const searchId = await publish();
    await expect(
      callFunction('sendFamilyContactRequest', { publishedSearchId: searchId }, tutorToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a second contact while one is pending, in EITHER direction', async () => {
    const searchId = await publish();
    await callFunction('sendFamilyContactRequest', { publishedSearchId: searchId }, tutorToken);
    await expect(
      callFunction('sendFamilyContactRequest', { publishedSearchId: searchId }, tutorToken),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    // The family cannot open a parallel conversation with the same tutor.
    await expect(
      callFunction(
        'sendTutorContactRequest',
        { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e' },
        parentToken,
      ),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  // ── the decline cooldown, scoped by who opened the request ────────────

  it("blocks the tutor for a week after the family declines the tutor's request", async () => {
    await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.tutor2.uid,
      initiatedBy: 'tutor',
      status: 'declined',
      respondedAt: new Date(),
    });
    const searchId = await publish();
    await expect(
      callFunction('sendFamilyContactRequest', { publishedSearchId: searchId }, tutorToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('lets the tutor try again once the cooldown has elapsed', async () => {
    await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.tutor2.uid,
      initiatedBy: 'tutor',
      status: 'declined',
      respondedAt: new Date(Date.now() - 8 * DAY_MS),
    });
    const searchId = await publish();
    const res = await callFunction<{ requestId: string }>(
      'sendFamilyContactRequest',
      { publishedSearchId: searchId },
      tutorToken,
    );
    expect(res.requestId).toBeTruthy();
  });

  it("a TUTOR's decline of the family's own request does not silence the tutor here", async () => {
    // The tutor said no to being hired then; that is not the family saying no
    // to being contacted.
    await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'declined',
      respondedAt: new Date(),
    });
    const searchId = await publish();
    const res = await callFunction<{ requestId: string }>(
      'sendFamilyContactRequest',
      { publishedSearchId: searchId },
      tutorToken,
    );
    expect(res.requestId).toBeTruthy();
  });

  it("a FAMILY's decline of a tutor's approach does not silence the family's own request", async () => {
    // The mirror of the pin above: sendTutorContactRequest's cooldown counts
    // only the TUTOR's declines of family-initiated requests.
    await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.tutor2.uid,
      initiatedBy: 'tutor',
      status: 'declined',
      respondedAt: new Date(),
    });
    const res = await callFunction<{ requestId: string }>(
      'sendTutorContactRequest',
      { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e' },
      parentToken,
    );
    expect(res.requestId).toBeTruthy();
  });

  // ── respondToFamilyContactRequest ─────────────────────────────────────

  async function tutorContacts(): Promise<string> {
    const searchId = await publish();
    const res = await callFunction<{ requestId: string }>(
      'sendFamilyContactRequest',
      { publishedSearchId: searchId },
      tutorToken,
    );
    return res.requestId;
  }

  it('accept unlocks the family in the tutor approvedFamilies and records the responder', async () => {
    const requestId = await tutorContacts();
    await callFunction('respondToFamilyContactRequest', { requestId, action: 'accept' }, parentToken);

    const db = getDb();
    const doc = (await db.collection('studyContactRequests').doc(requestId).get()).data()!;
    expect(doc.status).toBe('accepted');
    expect(doc.parentName).toBe('Marie Dupont');
    expect(doc.respondedAt).toBeTruthy();

    const tutor = (await db.collection('users').doc(seed.tutor2.uid).get()).data()!;
    expect(tutor.profiles.tutor.approvedFamilies).toContain(seed.family1Id);
  });

  it('decline closes the request and unlocks nothing', async () => {
    const requestId = await tutorContacts();
    await callFunction('respondToFamilyContactRequest', { requestId, action: 'decline' }, parentToken);

    const db = getDb();
    const doc = (await db.collection('studyContactRequests').doc(requestId).get()).data()!;
    expect(doc.status).toBe('declined');
    const tutor = (await db.collection('users').doc(seed.tutor2.uid).get()).data()!;
    expect(tutor.profiles.tutor.approvedFamilies ?? []).not.toContain(seed.family1Id);
  });

  it('notifies the TUTOR of the answer', async () => {
    const requestId = await tutorContacts();
    await callFunction('respondToFamilyContactRequest', { requestId, action: 'accept' }, parentToken);
    const notifs = await getDb().collection('notifications')
      .where('recipientUserId', '==', seed.tutor2.uid)
      .where('type', '==', 'study_request_accepted')
      .get();
    expect(notifs.size).toBe(1);
  });

  it('rejects a parent of a DIFFERENT family', async () => {
    const requestId = await tutorContacts();
    await expect(
      callFunction('respondToFamilyContactRequest', { requestId, action: 'accept' }, otherParentToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects the TUTOR answering their own request through the family door', async () => {
    const requestId = await tutorContacts();
    await expect(
      callFunction('respondToFamilyContactRequest', { requestId, action: 'accept' }, tutorToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a FAMILY-initiated request — that one is the tutor to answer', async () => {
    const requestId = await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
    });
    await expect(
      callFunction('respondToFamilyContactRequest', { requestId, action: 'accept' }, parentToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a second answer to the same request', async () => {
    const requestId = await tutorContacts();
    await callFunction('respondToFamilyContactRequest', { requestId, action: 'accept' }, parentToken);
    await expect(
      callFunction('respondToFamilyContactRequest', { requestId, action: 'decline' }, parentToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  // ── the tutor must not answer their own request through the OLD door ──

  it('respondToTutorContactRequest refuses a tutor-initiated request', async () => {
    // Without this the tutor who opened it passes the tutorUserId check and
    // could write their own approvedFamilies unlock — consent from nobody.
    const requestId = await tutorContacts();
    await expect(
      callFunction('respondToTutorContactRequest', { requestId, action: 'accept' }, tutorToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    const tutor = (await getDb().collection('users').doc(seed.tutor2.uid).get()).data()!;
    expect(tutor.profiles.tutor.approvedFamilies ?? []).not.toContain(seed.family1Id);
  });

  // ── searchTutors must not read a tutor's approach as the family's ─────

  it('a pending tutor-initiated request leaves the family search card fresh', async () => {
    await tutorContacts();
    const res = await callFunction<{ results: { uid: string; requestStatus?: string }[] }>(
      'searchTutors',
      { subject: 'math', level: '6e' },
      parentToken,
    );
    const card = res.results.find((r) => r.uid === seed.tutor2.uid);
    expect(card).toBeTruthy();
    expect(card!.requestStatus ?? 'none').toBe('none');
  });

  it('an ACCEPTED tutor-initiated request shows as accepted on the card', async () => {
    const requestId = await tutorContacts();
    await callFunction('respondToFamilyContactRequest', { requestId, action: 'accept' }, parentToken);
    const res = await callFunction<{ results: { uid: string; requestStatus?: string }[] }>(
      'searchTutors',
      { subject: 'math', level: '6e' },
      parentToken,
    );
    const card = res.results.find((r) => r.uid === seed.tutor2.uid);
    expect(card!.requestStatus).toBe('accepted');
  });
});
