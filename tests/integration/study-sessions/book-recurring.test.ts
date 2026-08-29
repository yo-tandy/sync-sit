import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

type BookResponse = { sessionId: string };

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Current Paris weekday key ('mon'..'sun') for the given instant. */
function parisWeekday(d: Date): string {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
  })
    .format(d)
    .toLowerCase()
    .slice(0, 3);
  return wd; // 'mon'..'sun' — matches DAYS_OF_WEEK
}

describe('bookSession — recurring', () => {
  let seed: SeedData;
  let parent1Token: string; // verified family1 (Dupont), 2 kids
  let flexTutorUid: string; // fully-available tutor for weekday-agnostic tests

  // A valid recurring booking against tutor2 on a fixed weekday tutor2 works
  // (Monday 16:00–20:00 → slots 64..79 true). schoolWeeksOnly omitted → default.
  const recurringInput = () => ({
    tutorUserId: seed.tutor2.uid,
    subject: 'math',
    level: '6e',
    sessionLengthMinutes: 60,
    location: 'online',
    studentIds: ['kid1', 'kid2'],
    type: 'recurring',
    recurringSlot: { day: 'mon', startTime: '16:00' },
  });

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);

    // A fully-available tutor so weekday-dependent tests isolate the behavior
    // under test from tutor2's grid geometry.
    const db = getDb();
    flexTutorUid = 'tutor-flex-recurring';
    const fullDay = new Array(96).fill(true);
    await db.collection('users').doc(flexTutorUid).set({
      uid: flexTutorUid, email: 'flexrec@ejm.org', status: 'active',
      firstName: 'Flex', lastName: 'Recurring', language: 'en',
      profiles: { tutor: {
        enrollmentComplete: true, ejemEmail: 'flexrec@ejm.org', searchable: true,
        approvedFamilies: [seed.family1Id], paddingMin: 0,
        subjects: [{ subject: 'math', levels: ['6e'], rate: 30 }],
        sessionLengthsMin: [45, 60], locationPrefs: ['online'],
      } },
      notifPrefs: {}, fcmTokens: [],
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    await db.collection('schedules').doc(flexTutorUid).set({
      weekly: { mon: fullDay, tue: fullDay, wed: fullDay, thu: fullDay, fri: fullDay, sat: fullDay, sun: fullDay },
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
      'notifPrefs.study.newRequest': { push: true, email: true },
    });
    for (const coll of ['study-sessions', 'notifications']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    for (const uid of [seed.tutor2.uid, flexTutorUid]) {
      const overrides = await db
        .collection('schedules').doc(uid).collection('overrides').get();
      await Promise.all(overrides.docs.map((d) => d.ref.delete()));
    }
  });

  // ── Happy path ──

  it('books a pending recurring series with slot, denorms, and rate snapshot', async () => {
    const db = getDb();
    const res = await callFunction<BookResponse>('bookSession', recurringInput(), parent1Token);
    expect(res.sessionId).toBeTruthy();

    const doc = (await db.collection('study-sessions').doc(res.sessionId).get()).data()!;
    expect(doc.status).toBe('pending');
    expect(doc.type).toBe('recurring');
    expect(doc.familyId).toBe(seed.family1Id);
    expect(doc.tutorUserId).toBe(seed.tutor2.uid);
    expect(doc.createdByUserId).toBe(seed.parent1.uid);
    expect(doc.subject).toBe('math');
    expect(doc.level).toBe('6e');
    expect(doc.rate).toBe(25); // snapshotted from tutor2's live math offering
    expect(doc.sessionLengthMinutes).toBe(60);
    expect(doc.location).toBe('online');
    expect(doc.paddingMinutes).toBe(15);
    // The canonical weekly slot, with server-derived endTime.
    expect(doc.recurringSlots).toEqual([
      { day: 'mon', startTime: '16:00', endTime: '17:00' },
    ]);
    // schoolWeeksOnly defaults to true when omitted from the input.
    expect(doc.schoolWeeksOnly).toBe(true);
    // Constant weekly start is stored top-level; NO concrete date/endTime.
    expect(doc.startTime).toBe('16:00');
    expect(doc.date).toBeUndefined();
    expect(doc.endTime).toBeUndefined();
    expect(doc.endDate).toBeUndefined();
    // Denorms
    expect(doc.studentIds).toEqual(['kid1', 'kid2']);
    expect(doc.students).toEqual([
      { firstName: 'Lucas', age: 6 },
      { firstName: 'Emma', age: 4 },
    ]);
    expect(doc.familyName).toBe('Dupont');
    expect(doc.parentName).toBe('Marie Dupont');
    // parentName's owner for the identity-correction fan-out (issue #273) —
    // pinned on the recurring shape too (separate doc literal in bookSession).
    expect(doc.parentUserId).toBe(seed.parent1.uid);
    expect(doc.tutorName).toBe('Yael Cohen');
  });

  it('creates NO instances and NO overrides for a pending series', async () => {
    const db = getDb();
    const res = await callFunction<BookResponse>('bookSession', recurringInput(), parent1Token);

    const instances = await db
      .collection('study-sessions').doc(res.sessionId).collection('instances').get();
    expect(instances.empty).toBe(true);

    const overrides = await db
      .collection('schedules').doc(seed.tutor2.uid).collection('overrides').get();
    expect(overrides.empty).toBe(true);
  });

  it('stores an explicit endDate when provided', async () => {
    const db = getDb();
    const res = await callFunction<BookResponse>(
      'bookSession',
      { ...recurringInput(), endDate: '2099-12-31' },
      parent1Token,
    );
    const doc = (await db.collection('study-sessions').doc(res.sessionId).get()).data()!;
    expect(doc.endDate).toBe('2099-12-31');
  });

  // ── Zero-candidate rejection ──

  it('rejects a series whose endDate precedes the first occurrence (invalid-argument)', async () => {
    await expect(
      callFunction('bookSession', { ...recurringInput(), endDate: '2020-01-06' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  // ── Duplicate guard ──

  it('rejects a duplicate pending recurring request for the same slot (already-exists)', async () => {
    await callFunction<BookResponse>('bookSession', recurringInput(), parent1Token);
    await expect(
      callFunction('bookSession', recurringInput(), parent1Token),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  // ── Notice window applies to the FIRST occurrence ──

  it('accepts a request whose weekday is today — the first occurrence rolls past the 24h window', async () => {
    // slot.day === today's Paris weekday: today's occurrence is within (or before)
    // the 24h notice window, so the engine must anchor expansion at now+24h and
    // roll the first occurrence to next week. Against a fully-available tutor this
    // isolates the notice behavior from grid geometry.
    const db = getDb();
    const today = parisWeekday(new Date());
    const res = await callFunction<BookResponse>(
      'bookSession',
      {
        ...recurringInput(),
        tutorUserId: flexTutorUid,
        recurringSlot: { day: today, startTime: '12:00' },
      },
      parent1Token,
    );
    expect(res.sessionId).toBeTruthy();
    const doc = (await db.collection('study-sessions').doc(res.sessionId).get()).data()!;
    expect(doc.recurringSlots).toEqual([
      { day: today, startTime: '12:00', endTime: '13:00' },
    ]);
  });

  // ── Inherited shared-chain gates still fire ──

  it('rejects a family not approved by the tutor with permission-denied', async () => {
    const db = getDb();
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [],
    });
    await expect(
      callFunction('bookSession', recurringInput(), parent1Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a recurring input missing the weekly slot (invalid-argument)', async () => {
    const { recurringSlot: _omit, ...noSlot } = recurringInput();
    await expect(
      callFunction('bookSession', noSlot, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  // ── Notifications ──

  it('writes a tutor notification stating the weekly cadence', async () => {
    const db = getDb();
    const res = await callFunction<BookResponse>('bookSession', recurringInput(), parent1Token);
    const notifs = await db
      .collection('notifications')
      .where('recipientUserId', '==', seed.tutor2.uid)
      .get();
    expect(notifs.size).toBe(1);
    expect(notifs.docs[0].data().data.sessionId).toBe(res.sessionId);
  });

  // ── Trial-first-session flag (V1.1) ──

  it('persists trialFirstSession when the family opts in', async () => {
    const db = getDb();
    const res = await callFunction<BookResponse>(
      'bookSession',
      { ...recurringInput(), trialFirstSession: true },
      parent1Token,
    );
    const doc = (await db.collection('study-sessions').doc(res.sessionId).get()).data()!;
    expect(doc.trialFirstSession).toBe(true);
  });

  it('omits trialFirstSession when absent or false (omit-when-false)', async () => {
    const db = getDb();
    // Absent → not persisted.
    const res1 = await callFunction<BookResponse>('bookSession', recurringInput(), parent1Token);
    const doc1 = (await db.collection('study-sessions').doc(res1.sessionId).get()).data()!;
    expect(doc1.trialFirstSession).toBeUndefined();

    // Explicit false → also omitted (distinct slot to dodge the duplicate guard).
    const res2 = await callFunction<BookResponse>(
      'bookSession',
      { ...recurringInput(), recurringSlot: { day: 'mon', startTime: '17:00' }, trialFirstSession: false },
      parent1Token,
    );
    const doc2 = (await db.collection('study-sessions').doc(res2.sessionId).get()).data()!;
    expect(doc2.trialFirstSession).toBeUndefined();
  });
});
