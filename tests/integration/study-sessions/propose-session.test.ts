import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Fixed far-future Monday matching tutor2's weekly grid (Mon 16:00–20:00 →
// slots 64..79 true). Far enough out that the 24h notice never trips.
const FUTURE_MON = '2027-06-07';

type ProposeResponse = { sessionId: string };

// ── Paris-time helpers for the 24h notice boundary ──
function parisParts(d: Date): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
function toHHMM(totalMin: number): string {
  return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
}
/** Paris date+startTime roughly `hours` from now, aligned to a 15-min slot. */
function proposeRaw(hoursFromNow: number): { date: string; startTime: string } {
  const target = new Date(Date.now() + hoursFromNow * 3600 * 1000);
  const { date, minutes } = parisParts(target);
  return { date, startTime: toHHMM(Math.floor(minutes / 15) * 15) };
}

describe('proposeSession', () => {
  let seed: SeedData;
  let parent1Token: string; // verified family1 (Dupont)
  let tutor1Token: string; // enrollment incomplete
  let tutor2Token: string; // the proposing tutor (active, enrolled)

  // A valid one-time proposal from tutor2 to family1 on the fixed future Monday.
  const happyInput = () => ({
    familyId: seed.family1Id,
    subject: 'math',
    level: '6e',
    date: FUTURE_MON,
    startTime: '16:00',
    sessionLengthMinutes: 60,
    location: 'online',
  });

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    tutor1Token = await getIdToken(seed.tutor1.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    // Approve family1 for tutor2 by default (happy path); negatives override.
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
    });
    for (const coll of ['study-sessions', 'notifications']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    const overrides = await db
      .collection('schedules').doc(seed.tutor2.uid).collection('overrides').get();
    await Promise.all(overrides.docs.map((d) => d.ref.delete()));
  });

  // ── Happy path ──

  it('proposes a pending provider session with empty students, rate snapshot, and computed endTime', async () => {
    const db = getDb();
    const res = await callFunction<ProposeResponse>('proposeSession', happyInput(), tutor2Token);
    expect(res.sessionId).toBeTruthy();

    const doc = (await db.collection('study-sessions').doc(res.sessionId).get()).data()!;
    expect(doc.status).toBe('pending');
    expect(doc.type).toBe('one_time');
    expect(doc.proposedBy).toBe('provider');
    expect(doc.familyId).toBe(seed.family1Id);
    expect(doc.tutorUserId).toBe(seed.tutor2.uid);
    expect(doc.createdByUserId).toBe(seed.tutor2.uid); // the proposing tutor
    expect(doc.subject).toBe('math');
    expect(doc.level).toBe('6e');
    expect(doc.rate).toBe(25); // snapshotted from tutor2's live math offering
    expect(doc.date).toBe(FUTURE_MON);
    expect(doc.startTime).toBe('16:00');
    expect(doc.endTime).toBe('17:00'); // 16:00 + 60 min
    expect(doc.sessionLengthMinutes).toBe(60);
    expect(doc.location).toBe('online');
    expect(doc.paddingMinutes).toBe(15); // from tutor2 profile
    // Students are chosen by the family at accept time — empty at propose time.
    expect(doc.studentIds).toEqual([]);
    expect(doc.students).toEqual([]);
    // Denormalized names: family + tutor server-side; parentName blank until accept.
    expect(doc.familyName).toBe('Dupont');
    expect(doc.parentName).toBe('');
    expect(doc.tutorName).toBe('Yael Cohen');
  });

  it('writes NO override for a pending proposal (schedule untouched)', async () => {
    const db = getDb();
    await callFunction<ProposeResponse>('proposeSession', happyInput(), tutor2Token);
    const overrides = await db
      .collection('schedules').doc(seed.tutor2.uid).collection('overrides').get();
    expect(overrides.empty).toBe(true);
  });

  // ── Gate negatives ──

  it('rejects unauthenticated calls', async () => {
    await expect(callFunction('proposeSession', happyInput())).rejects.toThrow();
  });

  it('rejects a non-tutor caller with permission-denied', async () => {
    await expect(
      callFunction('proposeSession', happyInput(), parent1Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a tutor who has not completed enrollment (failed-precondition)', async () => {
    const db = getDb();
    await db.collection('users').doc(seed.tutor1.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
    });
    await expect(
      callFunction('proposeSession', happyInput(), tutor1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a family the tutor has not approved with permission-denied', async () => {
    const db = getDb();
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [],
    });
    await expect(
      callFunction('proposeSession', happyInput(), tutor2Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an unknown family with not-found', async () => {
    const db = getDb();
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': ['ghost-family'],
    });
    await expect(
      callFunction('proposeSession', { ...happyInput(), familyId: 'ghost-family' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an unverified family with permission-denied', async () => {
    const db = getDb();
    // family2 (Martin) is not fully verified; approve it so the verification
    // gate is the sole reason for rejection.
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family2Id],
    });
    await expect(
      callFunction('proposeSession', { ...happyInput(), familyId: seed.family2Id }, tutor2Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a subject/level the tutor does not offer (failed-precondition)', async () => {
    // tutor2 offers math for 6e/5e/4e — 3e is not covered.
    await expect(
      callFunction('proposeSession', { ...happyInput(), level: '3e' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a session length the tutor does not offer (failed-precondition)', async () => {
    // tutor2 offers [45, 60]; 30 is a valid enum value but not offered.
    await expect(
      callFunction('proposeSession', { ...happyInput(), sessionLengthMinutes: 30 }, tutor2Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a location the tutor does not accept (failed-precondition)', async () => {
    // tutor2 accepts online + family_home; library is not offered.
    await expect(
      callFunction('proposeSession', { ...happyInput(), location: 'library' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a proposal less than 24h out (failed-precondition)', async () => {
    const { date, startTime } = proposeRaw(2);
    await expect(
      callFunction('proposeSession', { ...happyInput(), date, startTime }, tutor2Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects an unavailable slot with invalid-argument', async () => {
    // 10:00 on the future Monday is outside tutor2's 16:00–20:00 grid.
    await expect(
      callFunction('proposeSession', { ...happyInput(), startTime: '10:00' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  // ── Occupied slot (a confirmed session already holds the time) ──

  it('rejects a proposal whose slot is already confirmed (invalid-argument)', async () => {
    const db = getDb();
    // A confirmed session occupies 16:00–17:00 → best-effort pre-check fails.
    await db.collection('study-sessions').doc('confirmed-x').set({
      sessionId: 'confirmed-x', tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid, subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Yael Cohen',
      type: 'one_time', date: FUTURE_MON, startTime: '16:00', endTime: '17:00',
      sessionLengthMinutes: 60, location: 'online', paddingMinutes: 15,
      status: 'confirmed', createdAt: new Date(), updatedAt: new Date(),
    });
    await expect(
      callFunction('proposeSession', happyInput(), tutor2Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: 'slot not available' });
  });

  // ── Duplicate-pending guard ──

  it('rejects a duplicate pending proposal for the same slot with already-exists', async () => {
    await callFunction<ProposeResponse>('proposeSession', happyInput(), tutor2Token);
    await expect(
      callFunction('proposeSession', happyInput(), tutor2Token),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });

  // ── Notifications ──

  it('notifies the family parents of the proposal (study_session_proposed)', async () => {
    const db = getDb();
    await callFunction<ProposeResponse>('proposeSession', happyInput(), tutor2Token);
    // Both parents of family1 (parent1 + parent2) receive an in-app notification.
    const p1 = await db.collection('notifications')
      .where('recipientUserId', '==', seed.parent1.uid).get();
    expect(p1.docs.some((d) => d.data().type === 'study_session_proposed')).toBe(true);
    const p2 = await db.collection('notifications')
      .where('recipientUserId', '==', seed.parent2.uid).get();
    expect(p2.docs.some((d) => d.data().type === 'study_session_proposed')).toBe(true);
  });
});
