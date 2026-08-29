import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// A fixed far-future Monday (matches tutor2's weekly grid: Mon 16:00–20:00 →
// slots 64..79 true). Far enough out that the 24h notice never zeroes it.
const FUTURE_MON = '2027-06-07';

type BookResponse = { sessionId: string };

// ── Dynamic Paris-time helpers for the 24h notice boundary tests ──
function parisParts(d: Date): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
function toHHMM(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
/** Paris date+startTime roughly `hours` from now, aligned to a 15-min slot. */
function bookingRaw(hoursFromNow: number): { date: string; startTime: string } {
  const target = new Date(Date.now() + hoursFromNow * 3600 * 1000);
  const { date, minutes } = parisParts(target);
  return { date, startTime: toHHMM(Math.floor(minutes / 15) * 15) };
}
/** Like bookingRaw but avoids a booking that would run past midnight (only ever
 * pushes the instant FURTHER from now, so it stays > 24h for the pass test). */
function bookingSafe(hoursFromNow: number, lenMin: number): { date: string; startTime: string } {
  const target = new Date(Date.now() + hoursFromNow * 3600 * 1000);
  let { date, minutes } = parisParts(target);
  minutes = Math.floor(minutes / 15) * 15;
  if (minutes + lenMin > 24 * 60) {
    date = parisParts(new Date(target.getTime() + 24 * 3600 * 1000)).date;
    minutes = 12 * 60; // noon the next day — comfortably beyond 24h
  }
  return { date, startTime: toHHMM(minutes) };
}

describe('bookSession', () => {
  let seed: SeedData;
  let parent1Token: string; // verified family1 (Dupont), 2 kids
  let parent3Token: string; // unverified family2 (Martin)
  let tutor2Token: string;
  let flexTutorUid: string; // fully-available tutor for the notice-boundary pass

  // A valid one-time booking payload against tutor2 on the fixed future Monday.
  const happyInput = () => ({
    tutorUserId: seed.tutor2.uid,
    subject: 'math',
    level: '6e',
    date: FUTURE_MON,
    startTime: '16:00',
    sessionLengthMinutes: 60,
    location: 'online',
    studentIds: ['kid1', 'kid2'],
  });

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);

    // A tutor with a FULLY-available weekly grid, so the dynamic notice-boundary
    // "pass" test isolates the 24h gate from grid geometry.
    const db = getDb();
    flexTutorUid = 'tutor-flex';
    const fullDay = new Array(96).fill(true);
    await db.collection('users').doc(flexTutorUid).set({
      uid: flexTutorUid, email: 'flex@ejm.org', status: 'active',
      firstName: 'Flex', lastName: 'Tutor', language: 'en',
      profiles: { tutor: {
        enrollmentComplete: true, ejemEmail: 'flex@ejm.org', searchable: true,
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
    // Approve family1 for tutor2 by default (happy path); negatives override.
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
      'notifPrefs.study.newRequest': { push: true, email: true },
    });
    // Wipe sessions, tutor2 overrides, and notifications between tests.
    for (const coll of ['study-sessions', 'notifications']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    const overrides = await db
      .collection('schedules').doc(seed.tutor2.uid).collection('overrides').get();
    await Promise.all(overrides.docs.map((d) => d.ref.delete()));
  });

  // ── Happy path ──

  it('books a pending session with denorms, rate snapshot, and computed endTime', async () => {
    const db = getDb();
    const res = await callFunction<BookResponse>('bookSession', happyInput(), parent1Token);
    expect(res.sessionId).toBeTruthy();

    const doc = (await db.collection('study-sessions').doc(res.sessionId).get()).data()!;
    expect(doc.status).toBe('pending');
    expect(doc.type).toBe('one_time');
    expect(doc.familyId).toBe(seed.family1Id);
    expect(doc.tutorUserId).toBe(seed.tutor2.uid);
    expect(doc.createdByUserId).toBe(seed.parent1.uid);
    expect(doc.subject).toBe('math');
    expect(doc.level).toBe('6e');
    expect(doc.rate).toBe(25); // snapshotted from tutor2's live math offering
    expect(doc.date).toBe(FUTURE_MON);
    expect(doc.startTime).toBe('16:00');
    expect(doc.endTime).toBe('17:00'); // 16:00 + 60 min
    expect(doc.sessionLengthMinutes).toBe(60);
    expect(doc.location).toBe('online');
    expect(doc.paddingMinutes).toBe(15); // from tutor2 profile
    // Denorms
    expect(doc.studentIds).toEqual(['kid1', 'kid2']);
    expect(doc.students).toEqual([
      { firstName: 'Lucas', age: 6 },
      { firstName: 'Emma', age: 4 },
    ]);
    expect(doc.familyName).toBe('Dupont');
    expect(doc.parentName).toBe('Marie Dupont');
    // parentName's owner, so the identity-correction fan-out can reach the
    // snapshot (issue #273).
    expect(doc.parentUserId).toBe(seed.parent1.uid);
    expect(doc.tutorName).toBe('Yael Cohen');
  });

  it('writes NO override for a pending session (schedule untouched)', async () => {
    const db = getDb();
    await callFunction<BookResponse>('bookSession', happyInput(), parent1Token);
    const overrides = await db
      .collection('schedules').doc(seed.tutor2.uid).collection('overrides').get();
    expect(overrides.empty).toBe(true);
  });

  // Trial flag is a recurring-only concept; a one_time input carrying it is
  // ACCEPTED but the field is ignored (never persisted) — mirrors the
  // schoolWeeksOnly precedent (top-level, parsed on any input, used only by the
  // recurring path).
  it('ignores trialFirstSession on a one_time booking (accepted, not persisted)', async () => {
    const db = getDb();
    const res = await callFunction<BookResponse>(
      'bookSession',
      { ...happyInput(), trialFirstSession: true },
      parent1Token,
    );
    expect(res.sessionId).toBeTruthy(); // accepted, not rejected
    const doc = (await db.collection('study-sessions').doc(res.sessionId).get()).data()!;
    expect(doc.trialFirstSession).toBeUndefined(); // ignored on the one_time path
  });

  // ── Gate negatives ──

  it('rejects unauthenticated calls', async () => {
    await expect(callFunction('bookSession', happyInput())).rejects.toThrow();
  });

  it('rejects a non-parent caller with permission-denied', async () => {
    await expect(
      callFunction('bookSession', happyInput(), tutor2Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an unverified family with permission-denied', async () => {
    await expect(
      callFunction('bookSession', { ...happyInput(), studentIds: ['kid4'] }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a family not approved by the tutor with permission-denied', async () => {
    const db = getDb();
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [],
    });
    await expect(
      callFunction('bookSession', happyInput(), parent1Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an unknown tutor with not-found', async () => {
    await expect(
      callFunction('bookSession', { ...happyInput(), tutorUserId: 'no-such-tutor' }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a tutor who has not completed enrollment (failed-precondition)', async () => {
    // tutor1 (Noa): active but enrollmentComplete=false.
    await expect(
      callFunction('bookSession', { ...happyInput(), tutorUserId: seed.tutor1.uid }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a subject/level the tutor does not offer (failed-precondition)', async () => {
    // tutor2 offers math for 6e/5e/4e — 3e is not covered.
    await expect(
      callFunction('bookSession', { ...happyInput(), level: '3e' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a session length the tutor does not offer (failed-precondition)', async () => {
    // tutor2 offers [45, 60]; 30 is a valid enum value but not offered.
    await expect(
      callFunction('bookSession', { ...happyInput(), sessionLengthMinutes: 30 }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a location the tutor does not accept (failed-precondition)', async () => {
    // tutor2 accepts online + family_home; library is not offered.
    await expect(
      callFunction('bookSession', { ...happyInput(), location: 'library' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects an unavailable slot with invalid-argument', async () => {
    // 10:00 on the future Monday is outside tutor2's 16:00–20:00 grid.
    await expect(
      callFunction('bookSession', { ...happyInput(), startTime: '10:00' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects unknown students with not-found', async () => {
    await expect(
      callFunction('bookSession', { ...happyInput(), studentIds: ['kid1', 'ghost'] }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a student from another family with not-found', async () => {
    // kid4 belongs to family2 (Martin), not the caller's family1.
    await expect(
      callFunction('bookSession', { ...happyInput(), studentIds: ['kid4'] }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── 24h notice window (dynamic from now) ──

  it('rejects a booking less than 24h out (failed-precondition)', async () => {
    const { date, startTime } = bookingRaw(23);
    await expect(
      callFunction('bookSession', { ...happyInput(), date, startTime }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('accepts a booking just over 24h out', async () => {
    const { date, startTime } = bookingSafe(25, 60);
    const res = await callFunction<BookResponse>(
      'bookSession',
      { ...happyInput(), tutorUserId: flexTutorUid, date, startTime },
      parent1Token,
    );
    expect(res.sessionId).toBeTruthy();
  });

  // ── Duplicate-pending guard ──

  it('rejects a duplicate pending request for the same slot with already-exists', async () => {
    await callFunction<BookResponse>('bookSession', happyInput(), parent1Token);
    await expect(
      callFunction('bookSession', happyInput(), parent1Token),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  // ── Recurring input validation (full recurring behavior: book-recurring.test.ts) ──

  it('rejects a recurring booking with no weekly slot (invalid-argument)', async () => {
    // happyInput carries date+startTime but no recurringSlot — a recurring
    // request requires the slot (the one-time date/startTime are ignored).
    await expect(
      callFunction('bookSession', { ...happyInput(), type: 'recurring' }, parent1Token),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: 'Recurring bookings require a weekly slot',
    });
  });

  // ── Notifications ──

  it('writes a tutor notification for the request', async () => {
    const db = getDb();
    const res = await callFunction<BookResponse>('bookSession', happyInput(), parent1Token);
    const notifs = await db
      .collection('notifications')
      .where('recipientUserId', '==', seed.tutor2.uid)
      .get();
    expect(notifs.size).toBe(1);
    const n = notifs.docs[0].data();
    expect(n.type).toBe('study_session_request');
    expect(n.data.sessionId).toBe(res.sessionId);
    expect(n.emailSent).toBe(true); // default newRequest prefs: email on
  });

  it('respects the tutor\'s newRequest email preference', async () => {
    const db = getDb();
    await db.collection('users').doc(seed.tutor2.uid).update({
      'notifPrefs.study.newRequest': { push: true, email: false },
    });
    await callFunction<BookResponse>('bookSession', happyInput(), parent1Token);
    const notifs = await db
      .collection('notifications')
      .where('recipientUserId', '==', seed.tutor2.uid)
      .get();
    expect(notifs.size).toBe(1);
    expect(notifs.docs[0].data().emailSent).toBe(false);
  });
});
