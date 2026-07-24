import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Two fixed far-future Mondays matching tutor2's weekly grid (Mon 16:00–20:00 →
// slots 64..79 true). Far enough out that the 24h notice never trips at confirm.
const FUTURE_MON = '2027-06-07';
const FUTURE_MON_2 = '2027-06-14';
// A Monday well in the PAST — a series instance on this date is never "future".
const PAST_MON = '2020-01-06';

/** tutor2's Monday weekly grid: 16:00–20:00 (slots 64..79) true, else false. */
function weeklyMonGrid(): boolean[] {
  const g = new Array(96).fill(false);
  for (let i = 64; i < 80; i++) g[i] = true;
  return g;
}

describe('cancelSession', () => {
  let seed: SeedData;
  let parent1Token: string; // a parent of family1 (the session's family)
  let parent3Token: string; // a parent of family2 (a STRANGER to the session)
  let tutor2Token: string; // the session's owning tutor
  let tutor1Token: string; // a DIFFERENT tutor (not the session's tutor)

  interface SessionOverrides {
    sessionId?: string;
    familyId?: string;
    type?: 'one_time' | 'recurring';
    date?: string;
    startTime?: string;
    endTime?: string;
    location?: string;
    paddingMinutes?: number;
    status?: string;
  }

  async function seedSession(over: SessionOverrides = {}): Promise<string> {
    const db = getDb();
    const id = over.sessionId ?? `sess-${Math.random().toString(36).slice(2, 9)}`;
    await db.collection('study-sessions').doc(id).set({
      sessionId: id,
      tutorUserId: seed.tutor2.uid,
      familyId: over.familyId ?? seed.family1Id,
      createdByUserId: seed.parent1.uid,
      subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Yael Cohen',
      type: over.type ?? 'one_time',
      date: over.date ?? FUTURE_MON,
      startTime: over.startTime ?? '16:00',
      endTime: over.endTime ?? '17:00',
      sessionLengthMinutes: 60,
      location: over.location ?? 'online',
      paddingMinutes: over.paddingMinutes ?? 0,
      status: over.status ?? 'pending',
      createdAt: new Date(), updatedAt: new Date(),
    });
    return id;
  }

  /** Write an instance under a recurring parent. */
  async function seedInstance(
    sessionId: string,
    date: string,
    status: string,
    extra: Record<string, unknown> = {},
  ) {
    await getDb()
      .collection('study-sessions').doc(sessionId)
      .collection('instances').doc(date)
      .set({
        instanceId: date, sessionId, tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
        date, startTime: '16:00', endTime: '17:00', sessionLengthMinutes: 60, paddingMinutes: 0,
        subject: 'math', level: '6e', rate: 25, location: 'online',
        status, createdAt: new Date(), updatedAt: new Date(), ...extra,
      });
  }

  /** Write an "ours" (study-owned) override doc claiming block [startIdx,endIdx). */
  async function seedOursOverride(
    date: string,
    sessionId: string,
    startIdx: number,
    endIdx: number,
    instanceId?: string,
  ) {
    const slots = weeklyMonGrid();
    for (let i = startIdx; i < endIdx; i++) slots[i] = false;
    const entry: Record<string, unknown> = { sessionId, startIdx, endIdx };
    if (instanceId) entry.instanceId = instanceId;
    await overrideRef(date).set({
      date, type: 'custom', slots, sessionBlocks: [entry],
      appSource: 'study', reason: 'study_session', createdAt: new Date(), updatedAt: new Date(),
    });
  }

  const overrideRef = (date: string) =>
    getDb().collection('schedules').doc(seed.tutor2.uid).collection('overrides').doc(date);

  const sessionData = async (id: string) =>
    (await getDb().collection('study-sessions').doc(id).get()).data()!;

  const instanceData = async (id: string, date: string) =>
    (await getDb().collection('study-sessions').doc(id).collection('instances').doc(date).get()).data();

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);
    tutor1Token = await getIdToken(seed.tutor1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    // getTutorAvailability gates on approvedFamilies — grant family1 so the
    // full-96-grid snapshot calls resolve.
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
    });
    // Clear instances (subcollections survive parent deletion in the emulator).
    const inst = await db.collectionGroup('instances').get();
    await Promise.all(inst.docs.map((d) => d.ref.delete()));
    for (const coll of ['study-sessions', 'notifications']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    const overrides = await db
      .collection('schedules').doc(seed.tutor2.uid).collection('overrides').get();
    await Promise.all(overrides.docs.map((d) => d.ref.delete()));
  });

  // ── Validation + authorization gates ──

  it('rejects a missing/short reason with invalid-argument', async () => {
    const id = await seedSession({ status: 'confirmed' });
    await expect(
      callFunction('cancelSession', { sessionId: id, reason: 'ab' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      callFunction('cancelSession', { sessionId: id }, tutor2Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects an unknown session with not-found', async () => {
    await expect(
      callFunction('cancelSession', { sessionId: 'no-such', reason: 'changed my mind' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a stranger (parent of another family) with permission-denied', async () => {
    const id = await seedSession({ status: 'confirmed' });
    await expect(
      callFunction('cancelSession', { sessionId: id, reason: 'not my session' }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a different tutor (not the session tutor) with permission-denied', async () => {
    const id = await seedSession({ status: 'confirmed' });
    await expect(
      callFunction('cancelSession', { sessionId: id, reason: 'not my session' }, tutor1Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects cancelling a terminal (completed) session with failed-precondition', async () => {
    const id = await seedSession({ status: 'completed' });
    await expect(
      callFunction('cancelSession', { sessionId: id, reason: 'too late' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects cancelling an already-declined session with failed-precondition', async () => {
    const id = await seedSession({ status: 'declined' });
    await expect(
      callFunction('cancelSession', { sessionId: id, reason: 'too late' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects a double-cancel with failed-precondition (second call)', async () => {
    const id = await seedSession({ status: 'confirmed' });
    await callFunction('cancelSession', { sessionId: id, reason: 'first cancel' }, tutor2Token);
    await expect(
      callFunction('cancelSession', { sessionId: id, reason: 'second cancel' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  // ── Pending cancel: status flip only, no override churn ──

  it('cancels a pending session by family with NO override created', async () => {
    const id = await seedSession({ status: 'pending' });
    const res = await callFunction('cancelSession', { sessionId: id, reason: 'schedule clash' }, parent1Token);
    expect(res).toMatchObject({ success: true });

    const s = await sessionData(id);
    expect(s.status).toBe('cancelled');
    expect(s.statusReason).toBe('cancelled_by_family');
    expect(s.cancellationReason).toBe('schedule clash');
    expect(s.cancelledFromStatus).toBe('pending');
    expect(s.cancelledAt).toBeTruthy();
    // No override existed and none was created.
    expect((await overrideRef(FUTURE_MON).get()).exists).toBe(false);
  });

  // ── Confirmed one_time: lossless restoration ──

  it('restores the FULL 96-slot grid exactly on cancel and DELETES the ours-and-empty override', async () => {
    // Snapshot the tutor's availability grid BEFORE any booking exists.
    const before = await callFunction<{ dates: { date: string; slots: boolean[] }[] }>(
      'getTutorAvailability',
      { tutorUserId: seed.tutor2.uid, startDate: FUTURE_MON, endDate: FUTURE_MON },
      parent1Token,
    );
    const preGrid = before.dates[0].slots;

    // Confirm a session for real (writes the restorable override ledger).
    const id = await seedSession({ status: 'pending', startTime: '16:00', endTime: '17:00', location: 'online' });
    await callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token);
    // Sanity: the override now exists and blocks 64..67.
    const claimed = (await overrideRef(FUTURE_MON).get()).data()!;
    expect(claimed.slots[64]).toBe(false);
    expect(claimed.sessionBlocks).toEqual([{ sessionId: id, startIdx: 64, endIdx: 68 }]);

    // Cancel by the tutor.
    await callFunction('cancelSession', { sessionId: id, reason: 'tutor unavailable' }, tutor2Token);

    const s = await sessionData(id);
    expect(s.status).toBe('cancelled');
    expect(s.statusReason).toBe('cancelled_by_tutor');
    expect(s.cancelledFromStatus).toBe('confirmed');

    // ours + no remaining claims → override DELETED.
    expect((await overrideRef(FUTURE_MON).get()).exists).toBe(false);

    // Full 96-grid equality: availability is byte-for-byte the pre-booking grid.
    const after = await callFunction<{ dates: { date: string; slots: boolean[] }[] }>(
      'getTutorAvailability',
      { tutorUserId: seed.tutor2.uid, startDate: FUTURE_MON, endDate: FUTURE_MON },
      parent1Token,
    );
    expect(after.dates[0].slots).toEqual(preGrid);
  });

  it('preserves a ledgerless FOREIGN block in OUR doc: cross-app slot stays closed, our range restored, doc kept', async () => {
    // A study-owned override (reason study_session / appSource study) that ALSO
    // carries a sit-written block: sit's respondToRequest merges slots WITHOUT a
    // sessionBlocks entry, so slot 76 (19:00, weekly-open) is false with no
    // ledger record. Our own claim (64..68) is the only ledger entry.
    const slots = weeklyMonGrid();
    for (let i = 64; i < 68; i++) slots[i] = false; // our claim
    slots[76] = false; // ledgerless sit block, OUTSIDE our range
    const id = await seedSession({ status: 'confirmed', startTime: '16:00', endTime: '17:00', location: 'online' });
    await overrideRef(FUTURE_MON).set({
      date: FUTURE_MON, type: 'custom', slots,
      sessionBlocks: [{ sessionId: id, startIdx: 64, endIdx: 68 }],
      appSource: 'study', reason: 'study_session', createdAt: new Date(), updatedAt: new Date(),
    });

    await callFunction('cancelSession', { sessionId: id, reason: 'tutor unavailable' }, tutor2Token);

    const ov = (await overrideRef(FUTURE_MON).get()).data();
    // Doc NOT deleted despite an empty ledger — a foreign block still lives here.
    expect(ov).toBeTruthy();
    expect(ov!.sessionBlocks).toEqual([]);
    // Our claimed range restored to the weekly grid.
    expect(ov!.slots[64]).toBe(true);
    expect(ov!.slots[67]).toBe(true);
    // The ledgerless sit block is UNTOUCHED (no cross-app double-booking).
    expect(ov!.slots[76]).toBe(false);
  });

  it('recomputes the override losslessly when a SURVIVING claim remains', async () => {
    // Confirm two non-overlapping one_time sessions on the same date.
    const a = await seedSession({ sessionId: 'sess-a', status: 'pending', startTime: '16:00', endTime: '17:00' });
    const b = await seedSession({ sessionId: 'sess-b', status: 'pending', startTime: '18:00', endTime: '19:00' });
    await callFunction('respondToSession', { sessionId: a, action: 'confirm' }, tutor2Token);
    await callFunction('respondToSession', { sessionId: b, action: 'confirm' }, tutor2Token);

    // Expected override slots after cancelling B: weekly grid minus A's block (64..67).
    const expected = weeklyMonGrid();
    for (let i = 64; i < 68; i++) expected[i] = false;

    await callFunction('cancelSession', { sessionId: b, reason: 'double booked' }, tutor2Token);

    const ov = (await overrideRef(FUTURE_MON).get()).data()!;
    // A's claim survives; B's block (72..75) is restored to the weekly grid.
    expect(ov.slots).toEqual(expected);
    expect(ov.sessionBlocks).toEqual([{ sessionId: a, startIdx: 64, endIdx: 68 }]);
  });

  it('conserves a FOREIGN override: removes only our ledger entry, keeps foreign slots & fields', async () => {
    // A pre-existing sit-style / manual override (reason not study_session).
    const slots = new Array(96).fill(true);
    slots[70] = false; // a pre-existing foreign block, OUTSIDE our range
    slots[40] = false;
    await overrideRef(FUTURE_MON).set({
      date: FUTURE_MON, type: 'custom', slots,
      reason: 'manual_block', appointmentId: 'apt-legacy', createdAt: new Date(),
    });

    // Confirm a session — merges our claim INTO the foreign doc.
    const id = await seedSession({ status: 'pending', startTime: '16:00', endTime: '17:00', location: 'online' });
    await callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token);
    // Our block AND-ed to false, foreign fields preserved, ledger appended.
    const merged = (await overrideRef(FUTURE_MON).get()).data()!;
    expect(merged.slots[64]).toBe(false);
    expect(merged.sessionBlocks).toEqual([{ sessionId: id, startIdx: 64, endIdx: 68 }]);

    await callFunction('cancelSession', { sessionId: id, reason: 'tutor unavailable' }, tutor2Token);

    const ov = (await overrideRef(FUTURE_MON).get()).data()!;
    // Doc NOT deleted (it isn't ours to delete) and our ledger entry removed.
    expect(ov.sessionBlocks).toEqual([]);
    // CONSERVATIVE: our claimed slots stay FALSE (we cannot prove the foreign
    // owner doesn't also depend on them).
    expect(ov.slots[64]).toBe(false);
    expect(ov.slots[67]).toBe(false);
    // Pre-existing foreign false slots preserved.
    expect(ov.slots[70]).toBe(false);
    expect(ov.slots[40]).toBe(false);
    // Foreign identifying fields preserved.
    expect(ov.appointmentId).toBe('apt-legacy');
    expect(ov.reason).toBe('manual_block');
  });

  it('notifies the tutor when the FAMILY cancels a confirmed session', async () => {
    const db = getDb();
    const id = await seedSession({ status: 'pending', startTime: '16:00', endTime: '17:00' });
    await callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token);
    // Drop the confirm notifications so the assertion only sees the cancel.
    const pre = await db.collection('notifications').get();
    await Promise.all(pre.docs.map((d) => d.ref.delete()));

    await callFunction('cancelSession', { sessionId: id, reason: 'family cancel' }, parent1Token);

    const notifs = await db.collection('notifications')
      .where('recipientUserId', '==', seed.tutor2.uid).get();
    expect(notifs.size).toBeGreaterThanOrEqual(1);
    expect(notifs.docs.some((d) => d.data().type === 'study_session_cancelled')).toBe(true);
  });

  it('notifies the family when the TUTOR cancels a confirmed session', async () => {
    const db = getDb();
    const id = await seedSession({ status: 'confirmed', startTime: '16:00', endTime: '17:00' });
    await seedOursOverride(FUTURE_MON, id, 64, 68);

    await callFunction('cancelSession', { sessionId: id, reason: 'tutor cancel' }, tutor2Token);

    const notifs = await db.collection('notifications')
      .where('recipientUserId', '==', seed.parent1.uid).get();
    expect(notifs.docs.some((d) => d.data().type === 'study_session_cancelled')).toBe(true);
  });

  // ── Confirmed recurring (series) cancel ──

  it('cancels a whole series: future scheduled instances cancelled, PAST instance untouched, future overrides restored', async () => {
    const db = getDb();
    const id = await seedSession({
      sessionId: 'series-1', type: 'recurring', status: 'confirmed',
      date: undefined, startTime: '16:00', endTime: '17:00',
    });
    // Two future scheduled instances (with ours overrides), one PAST scheduled
    // instance (must be untouched), and one already-cancelled conflict_skip
    // instance in the future (not 'scheduled' → untouched).
    await seedInstance(id, FUTURE_MON, 'scheduled');
    await seedInstance(id, FUTURE_MON_2, 'scheduled');
    await seedInstance(id, PAST_MON, 'scheduled');
    await seedInstance(id, '2027-06-21', 'cancelled', { statusReason: 'conflict_skip' });
    await seedOursOverride(FUTURE_MON, id, 64, 68, FUTURE_MON);
    await seedOursOverride(FUTURE_MON_2, id, 64, 68, FUTURE_MON_2);

    const res = await callFunction('cancelSession', { sessionId: id, reason: 'moving away' }, tutor2Token);
    expect(res).toMatchObject({ success: true });

    // Parent series cancelled.
    const parent = await sessionData(id);
    expect(parent.status).toBe('cancelled');
    expect(parent.statusReason).toBe('cancelled_by_tutor');

    // Future scheduled instances → cancelled with the same statusReason/reason.
    for (const d of [FUTURE_MON, FUTURE_MON_2]) {
      const inst = await instanceData(id, d);
      expect(inst!.status).toBe('cancelled');
      expect(inst!.statusReason).toBe('cancelled_by_tutor');
      expect(inst!.cancellationReason).toBe('moving away');
      // Their ours-and-empty overrides were DELETED.
      expect((await overrideRef(d).get()).exists).toBe(false);
    }

    // PAST scheduled instance: UNTOUCHED (still scheduled).
    const past = await instanceData(id, PAST_MON);
    expect(past!.status).toBe('scheduled');

    // conflict_skip instance: UNTOUCHED (not 'scheduled').
    const skip = await instanceData(id, '2027-06-21');
    expect(skip!.status).toBe('cancelled');
    expect(skip!.statusReason).toBe('conflict_skip');

    // ONE series-level notification to the family.
    const notifs = await db.collection('notifications')
      .where('recipientUserId', '==', seed.parent1.uid).get();
    const cancels = notifs.docs.filter((d) => d.data().type === 'study_session_cancelled');
    expect(cancels.length).toBe(1);
  });

  it('cancels a pending recurring series by status flip with no instances/overrides', async () => {
    const id = await seedSession({
      sessionId: 'series-pending', type: 'recurring', status: 'pending', date: undefined,
    });
    const res = await callFunction('cancelSession', { sessionId: id, reason: 'never mind' }, parent1Token);
    expect(res).toMatchObject({ success: true });
    const parent = await sessionData(id);
    expect(parent.status).toBe('cancelled');
    expect(parent.statusReason).toBe('cancelled_by_family');
    expect(parent.cancelledFromStatus).toBe('pending');
  });

  // ── Pending provider PROPOSAL cancels as a pure flip by either party ──
  // The dual-role detection already keys off tutorUserId vs family membership,
  // so a proposal (proposedBy:'provider', createdBy:tutor) needs no special path.

  /** Seed a pending provider proposal (created by the tutor, empty roster). */
  async function seedProposal(sessionId: string): Promise<string> {
    await getDb().collection('study-sessions').doc(sessionId).set({
      sessionId, tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
      createdByUserId: seed.tutor2.uid, proposedBy: 'provider',
      subject: 'math', level: '6e', rate: 25, studentIds: [], students: [],
      familyName: 'Dupont', parentName: '', tutorName: 'Yael Cohen',
      type: 'one_time', date: FUTURE_MON, startTime: '16:00', endTime: '17:00',
      sessionLengthMinutes: 60, location: 'online', paddingMinutes: 0,
      status: 'pending', createdAt: new Date(), updatedAt: new Date(),
    });
    return sessionId;
  }

  it('cancels a pending proposal by the proposing tutor (pure flip, cancelled_by_tutor)', async () => {
    const id = await seedProposal('prop-cancel-tutor');
    const res = await callFunction('cancelSession', { sessionId: id, reason: 'changed my mind' }, tutor2Token);
    expect(res).toMatchObject({ success: true });
    const s = await sessionData(id);
    expect(s.status).toBe('cancelled');
    expect(s.statusReason).toBe('cancelled_by_tutor');
    expect(s.cancelledFromStatus).toBe('pending');
    expect((await overrideRef(FUTURE_MON).get()).exists).toBe(false);
  });

  it('cancels a pending proposal by the family (pure flip, cancelled_by_family)', async () => {
    const id = await seedProposal('prop-cancel-family');
    const res = await callFunction('cancelSession', { sessionId: id, reason: 'not needed' }, parent1Token);
    expect(res).toMatchObject({ success: true });
    const s = await sessionData(id);
    expect(s.status).toBe('cancelled');
    expect(s.statusReason).toBe('cancelled_by_family');
    expect(s.cancelledFromStatus).toBe('pending');
    expect((await overrideRef(FUTURE_MON).get()).exists).toBe(false);
  });
});
