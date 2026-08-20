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
      createdByUserId: seed.parent1.uid,
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
    // Reset the two server-owned fields the gates read, so a pin that flips
    // one cannot leak into the next case.
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [],
      'profiles.tutor.searchable': true,
      status: 'active',
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

  it('rejects a caller with no tutor profile (a parent lands on the enrollment gate)', async () => {
    const searchId = await publish();
    await expect(
      callFunction('sendFamilyContactRequest', { publishedSearchId: searchId }, parentToken),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a NON-ACTIVE tutor with permission-denied (the status gate, not the profile one)', async () => {
    const db = getDb();
    await db.collection('users').doc(seed.tutor2.uid).update({ status: 'suspended' });
    const searchId = await publish();
    try {
      await expect(
        callFunction('sendFamilyContactRequest', { publishedSearchId: searchId }, tutorToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    } finally {
      await db.collection('users').doc(seed.tutor2.uid).update({ status: 'active' });
    }
  });

  it('rejects a HIDDEN tutor: an accepted family could never reach them', async () => {
    // searchTutors filters on profiles.tutor.searchable, and its TutorCard is
    // the family's only contact-reveal surface -- so a hidden tutor being
    // accepted would leave the family with two dead-end links (PR #213
    // review). enrollTutor writes searchable: false, so this is the DEFAULT
    // state of a new tutor.
    const db = getDb();
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.searchable': false,
    });
    const searchId = await publish();
    try {
      await expect(
        callFunction('sendFamilyContactRequest', { publishedSearchId: searchId }, tutorToken),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    } finally {
      await db.collection('users').doc(seed.tutor2.uid).update({
        'profiles.tutor.searchable': true,
      });
    }
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

  it('the accepted family can actually SEE the tutor in search (the point of the yes)', async () => {
    // The plan's T2 pin: accept must leave the family able to reach the tutor.
    // With no searchable gate on the send side this failed silently -- the
    // family consented and got two dead-end links (PR #213 review).
    const requestId = await tutorContacts();
    await callFunction('respondToFamilyContactRequest', { requestId, action: 'accept' }, parentToken);

    const res = await callFunction<{ results: { uid: string; contactEmail?: string }[] }>(
      'searchTutors',
      { subject: 'math', level: '6e' },
      parentToken,
    );
    const card = res.results.find((r) => r.uid === seed.tutor2.uid);
    expect(card).toBeTruthy();
    // Contact is projected only for an approved family -- this is the reveal.
    expect(card!.contactEmail).toBeTruthy();
  });

  it('accepting a request whose tutor is gone fails legibly, not as an internal error', async () => {
    const requestId = await tutorContacts();
    const db = getDb();
    const tutorSnap = await db.collection('users').doc(seed.tutor2.uid).get();
    await db.collection('users').doc(seed.tutor2.uid).delete();
    try {
      await expect(
        callFunction('respondToFamilyContactRequest', { requestId, action: 'accept' }, parentToken),
      ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
    } finally {
      await db.collection('users').doc(seed.tutor2.uid).set(tutorSnap.data()!);
    }
  });

  it('declining still works when the tutor is gone (that branch writes no tutor doc)', async () => {
    const requestId = await tutorContacts();
    const db = getDb();
    const tutorSnap = await db.collection('users').doc(seed.tutor2.uid).get();
    await db.collection('users').doc(seed.tutor2.uid).delete();
    try {
      await callFunction('respondToFamilyContactRequest', { requestId, action: 'decline' }, parentToken);
      const doc = (await db.collection('studyContactRequests').doc(requestId).get()).data()!;
      expect(doc.status).toBe('declined');
    } finally {
      await db.collection('users').doc(seed.tutor2.uid).set(tutorSnap.data()!);
    }
  });

  // ── withdrawing: the initiator's lever, and only theirs ───────────────

  it('the tutor can withdraw their own pending request, and the pair is free again', async () => {
    // Without this the pending guard locks BOTH directions until the family
    // answers -- and a family that simply ignores it never does (PR #213
    // review). Published searches expire; the request does not.
    const requestId = await tutorContacts();
    await callFunction('cancelContactRequest', { requestId }, tutorToken);

    const doc = (await getDb().collection('studyContactRequests').doc(requestId).get()).data()!;
    expect(doc.status).toBe('cancelled');

    // Withdrawing is not a decline, so neither side is in cooldown.
    const again = await callFunction<{ requestId: string }>(
      'sendTutorContactRequest',
      { tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e' },
      parentToken,
    );
    expect(again.requestId).toBeTruthy();
  });

  it('a PARENT cannot cancel a tutor-initiated request — they must decline it', async () => {
    // Cancelling would tell the tutor "the family withdrew their request",
    // which they never sent, and would slip the family's real answer past the
    // decline cooldown.
    const requestId = await tutorContacts();
    await expect(
      callFunction('cancelContactRequest', { requestId }, parentToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('a TUTOR cannot cancel a family-initiated request', async () => {
    const requestId = await seedStudyContactRequest({
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
    });
    await expect(
      callFunction('cancelContactRequest', { requestId }, tutorToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
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

  it("a pending tutor-initiated request reads as INCOMING, not as the family's own", async () => {
    // Not 'pending' -- the family did not send it, and the card would claim
    // they had. Not 'none' either: that renders a send CTA which
    // sendTutorContactRequest rejects as already-exists, contradicting the
    // card the family just clicked (PR #213 review). Its own status lets the
    // card point at the page where Accept lives.
    await tutorContacts();
    const res = await callFunction<{ results: { uid: string; requestStatus?: string }[] }>(
      'searchTutors',
      { subject: 'math', level: '6e' },
      parentToken,
    );
    const card = res.results.find((r) => r.uid === seed.tutor2.uid);
    expect(card).toBeTruthy();
    expect(card!.requestStatus).toBe('incoming');
  });

  it('a DECLINED tutor-initiated request is not this family\'s history — the card stays fresh', async () => {
    const requestId = await tutorContacts();
    await callFunction('respondToFamilyContactRequest', { requestId, action: 'decline' }, parentToken);
    const res = await callFunction<{ results: { uid: string; requestStatus?: string }[] }>(
      'searchTutors',
      { subject: 'math', level: '6e' },
      parentToken,
    );
    const card = res.results.find((r) => r.uid === seed.tutor2.uid);
    // The family never asked this tutor for anything, so nothing to echo --
    // and the declinedHint copy would be wrong about who declined.
    expect(card!.requestStatus).toBe('none');
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
