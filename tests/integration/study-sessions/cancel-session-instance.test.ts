import { createRequire } from 'module';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const require = createRequire(import.meta.url);
// Imported after `pnpm --filter study-functions build` (the settled-decision
// interaction runs the real extend cron against a cancelled instance).
const { runExtendRecurring } = require(
  '../../../apps/study-functions/dist/scheduled/extendRecurring.js',
) as typeof import('../../../apps/study-functions/src/scheduled/extendRecurring.js');

// Two fixed far-future Mondays matching tutor2's weekly grid (Mon 16:00–20:00 →
// slots 64..79 true).
const FUTURE_MON = '2027-06-07';
const FUTURE_MON_2 = '2027-06-14';

/** tutor2's Monday weekly grid: 16:00–20:00 (slots 64..79) true, else false. */
function weeklyMonGrid(): boolean[] {
  const g = new Array(96).fill(false);
  for (let i = 64; i < 80; i++) g[i] = true;
  return g;
}

// ── Date helpers for the flex-tutor recurring confirm (mirror the confirm) ──
const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
function incDate(s: string): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(s: string): string {
  return KEYS[new Date(`${s}T00:00:00Z`).getUTCDay()];
}
function parisDateOf(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
}
function addMin(t: string, min: number): string {
  const [h, m] = t.split(':').map(Number);
  const tot = h * 60 + m + min;
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
}
/** The date the confirm anchors expansion at: now+24h Paris. */
function fromDate(): string {
  return parisDateOf(new Date(Date.now() + 24 * 60 * 60 * 1000));
}
/** Candidate occurrence dates, mirroring expandRecurringDates (sans holidays). */
function candidatesFor(day: string, weeks: number): string[] {
  let c = fromDate();
  while (weekdayOf(c) !== day) c = incDate(c);
  const out: string[] = [];
  for (let w = 0; w < weeks; w++) {
    out.push(c);
    for (let k = 0; k < 7; k++) c = incDate(c);
  }
  return out;
}

describe('cancelSessionInstance', () => {
  let seed: SeedData;
  let parent1Token: string; // a parent of the instance's family
  let parent3Token: string; // a stranger (other family)
  let tutor2Token: string; // the instance's owning tutor
  let flexTutorUid: string;
  let flexToken: string;

  const overrideRef = (uid: string, date: string) =>
    getDb().collection('schedules').doc(uid).collection('overrides').doc(date);

  const instanceRef = (sessionId: string, date: string) =>
    getDb().collection('study-sessions').doc(sessionId).collection('instances').doc(date);

  const instanceData = async (sessionId: string, date: string) =>
    (await instanceRef(sessionId, date).get()).data();

  const sessionData = async (id: string) =>
    (await getDb().collection('study-sessions').doc(id).get()).data()!;

  /** Seed a CONFIRMED recurring parent (tutor2) with no instances yet. */
  async function seedConfirmedSeries(sessionId = `series-${Math.random().toString(36).slice(2, 8)}`) {
    await getDb().collection('study-sessions').doc(sessionId).set({
      sessionId, tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid, subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Yael Cohen',
      type: 'recurring', startTime: '16:00', sessionLengthMinutes: 60,
      recurringSlots: [{ day: 'mon', startTime: '16:00', endTime: '17:00' }],
      schoolWeeksOnly: true, location: 'online', paddingMinutes: 0,
      status: 'confirmed', createdAt: new Date(), updatedAt: new Date(), confirmedAt: new Date(),
    });
    return sessionId;
  }

  async function seedInstance(sessionId: string, date: string, status: string, extra: Record<string, unknown> = {}) {
    await instanceRef(sessionId, date).set({
      instanceId: date, sessionId, tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
      date, startTime: '16:00', endTime: '17:00', sessionLengthMinutes: 60, paddingMinutes: 0,
      subject: 'math', level: '6e', rate: 25, location: 'online',
      status, createdAt: new Date(), updatedAt: new Date(), ...extra,
    });
  }

  /** Write an "ours" override with the given ledger entries claiming their ranges. */
  async function seedOursOverride(
    date: string,
    entries: { sessionId: string; startIdx: number; endIdx: number; instanceId?: string }[],
  ) {
    const slots = weeklyMonGrid();
    for (const e of entries) for (let i = e.startIdx; i < e.endIdx; i++) slots[i] = false;
    await overrideRef(seed.tutor2.uid, date).set({
      date, type: 'custom', slots, sessionBlocks: entries,
      appSource: 'study', reason: 'study_session', createdAt: new Date(), updatedAt: new Date(),
    });
  }

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);

    // A fully-available flex tutor for the real recurring-confirm interaction.
    const db = getDb();
    flexTutorUid = 'tutor-flex-instance';
    flexToken = await getIdToken(flexTutorUid);
    const fullDay = new Array(96).fill(true);
    await db.collection('users').doc(flexTutorUid).set({
      uid: flexTutorUid, email: 'flexinstance@ejm.org', status: 'active',
      firstName: 'Flex', lastName: 'Tutor', language: 'en',
      profiles: { tutor: {
        enrollmentComplete: true, searchable: true, approvedFamilies: [seed.family1Id],
        paddingMin: 0, subjects: [{ subject: 'math', levels: ['6e'], rate: 30 }],
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
    const inst = await db.collectionGroup('instances').get();
    await Promise.all(inst.docs.map((d) => d.ref.delete()));
    for (const coll of ['study-sessions', 'notifications', 'holidays']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    for (const uid of [seed.tutor2.uid, flexTutorUid]) {
      const ov = await db.collection('schedules').doc(uid).collection('overrides').get();
      await Promise.all(ov.docs.map((d) => d.ref.delete()));
    }
  });

  // ── Validation + gate negatives ──

  it('rejects a short reason with invalid-argument', async () => {
    const id = await seedConfirmedSeries();
    await seedInstance(id, FUTURE_MON, 'scheduled');
    await expect(
      callFunction('cancelSessionInstance', { sessionId: id, instanceId: FUTURE_MON, reason: 'x' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects an unknown instance with not-found', async () => {
    const id = await seedConfirmedSeries();
    await expect(
      callFunction('cancelSessionInstance', { sessionId: id, instanceId: '2027-01-04', reason: 'no such date' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a stranger (other family) with permission-denied', async () => {
    const id = await seedConfirmedSeries();
    await seedInstance(id, FUTURE_MON, 'scheduled');
    await expect(
      callFunction('cancelSessionInstance', { sessionId: id, instanceId: FUTURE_MON, reason: 'not mine' }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects cancelling an already-cancelled instance with failed-precondition', async () => {
    const id = await seedConfirmedSeries();
    await seedInstance(id, FUTURE_MON, 'cancelled', { statusReason: 'conflict_skip' });
    await expect(
      callFunction('cancelSessionInstance', { sessionId: id, instanceId: FUTURE_MON, reason: 'too late' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects cancelling an instance whose parent is not confirmed', async () => {
    const id = await seedConfirmedSeries();
    await getDb().collection('study-sessions').doc(id).update({ status: 'cancelled' });
    await seedInstance(id, FUTURE_MON, 'scheduled');
    await expect(
      callFunction('cancelSessionInstance', { sessionId: id, instanceId: FUTURE_MON, reason: 'series gone' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  // ── Happy path: single date off, siblings + parent untouched ──

  it('family cancels one date: instance cancelled, sibling untouched, override restored, parent still confirmed', async () => {
    const id = await seedConfirmedSeries();
    await seedInstance(id, FUTURE_MON, 'scheduled');
    await seedInstance(id, FUTURE_MON_2, 'scheduled');
    await seedOursOverride(FUTURE_MON, [{ sessionId: id, startIdx: 64, endIdx: 68, instanceId: FUTURE_MON }]);
    await seedOursOverride(FUTURE_MON_2, [{ sessionId: id, startIdx: 64, endIdx: 68, instanceId: FUTURE_MON_2 }]);

    const res = await callFunction('cancelSessionInstance', { sessionId: id, instanceId: FUTURE_MON, reason: 'sick that day' }, parent1Token);
    expect(res).toMatchObject({ success: true });

    const cancelled = await instanceData(id, FUTURE_MON);
    expect(cancelled!.status).toBe('cancelled');
    expect(cancelled!.statusReason).toBe('cancelled_by_family');
    expect(cancelled!.cancellationReason).toBe('sick that day');
    expect(cancelled!.cancelledAt).toBeTruthy();

    // Sibling untouched.
    const sibling = await instanceData(id, FUTURE_MON_2);
    expect(sibling!.status).toBe('scheduled');
    expect((await overrideRef(seed.tutor2.uid, FUTURE_MON_2).get()).exists).toBe(true);

    // Cancelled date's ours-and-empty override deleted (slot restored).
    expect((await overrideRef(seed.tutor2.uid, FUTURE_MON).get()).exists).toBe(false);

    // Parent series still confirmed.
    expect((await sessionData(id)).status).toBe('confirmed');

    // Tutor notified (family cancelled).
    const notifs = await getDb().collection('notifications')
      .where('recipientUserId', '==', seed.tutor2.uid).get();
    expect(notifs.docs.some((d) => d.data().type === 'study_session_cancelled')).toBe(true);
  });

  it('tutor cancels one date: statusReason cancelled_by_tutor, family notified', async () => {
    const id = await seedConfirmedSeries();
    await seedInstance(id, FUTURE_MON, 'scheduled');
    await seedOursOverride(FUTURE_MON, [{ sessionId: id, startIdx: 64, endIdx: 68, instanceId: FUTURE_MON }]);

    await callFunction('cancelSessionInstance', { sessionId: id, instanceId: FUTURE_MON, reason: 'unavailable' }, tutor2Token);

    const inst = await instanceData(id, FUTURE_MON);
    expect(inst!.status).toBe('cancelled');
    expect(inst!.statusReason).toBe('cancelled_by_tutor');

    const notifs = await getDb().collection('notifications')
      .where('recipientUserId', '==', seed.parent1.uid).get();
    expect(notifs.docs.some((d) => d.data().type === 'study_session_cancelled')).toBe(true);
  });

  // ── Lossless override restoration when a SURVIVING claim shares the date ──

  it('restores the override losslessly (full-96 grid) when another claim survives on that date', async () => {
    const id = await seedConfirmedSeries();
    await seedInstance(id, FUTURE_MON, 'scheduled');
    // The date's override holds TWO claims: this instance (64..68) AND a separate
    // one_time session (72..76). Cancelling the instance must give back ONLY the
    // instance's slots and keep the sibling claim's slots blocked.
    await seedOursOverride(FUTURE_MON, [
      { sessionId: id, startIdx: 64, endIdx: 68, instanceId: FUTURE_MON },
      { sessionId: 'other-one-time', startIdx: 72, endIdx: 76 },
    ]);

    await callFunction('cancelSessionInstance', { sessionId: id, instanceId: FUTURE_MON, reason: 'clash' }, tutor2Token);

    const expected = weeklyMonGrid();
    for (let i = 72; i < 76; i++) expected[i] = false; // only the survivor's block

    const ov = (await overrideRef(seed.tutor2.uid, FUTURE_MON).get()).data()!;
    expect(ov.slots).toEqual(expected);
    expect(ov.sessionBlocks).toEqual([{ sessionId: 'other-one-time', startIdx: 72, endIdx: 76 }]);
  });

  // ── The settled-decision interaction: extendRecurring must NOT resurrect ──

  it('extendRecurring does NOT regenerate a cancelled instance (settled decision)', async () => {
    const day = weekdayOf(incDate(fromDate())); // first occurrence ≥ ~48h out
    const expected = candidatesFor(day, 8);

    // Seed a pending recurring series for the flex tutor and CONFIRM it for real
    // → 8 scheduled instances on the candidate dates, each with an override.
    const id = `rec-inst-${Math.random().toString(36).slice(2, 8)}`;
    await getDb().collection('study-sessions').doc(id).set({
      sessionId: id, familyId: seed.family1Id, tutorUserId: flexTutorUid,
      createdByUserId: seed.parent1.uid, subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Flex Tutor',
      type: 'recurring', startTime: '12:00', sessionLengthMinutes: 60,
      recurringSlots: [{ day, startTime: '12:00', endTime: '13:00' }],
      schoolWeeksOnly: true, location: 'online', paddingMinutes: 0,
      status: 'pending', createdAt: new Date(), updatedAt: new Date(),
    });
    await callFunction('respondToSession', { sessionId: id, action: 'confirm' }, flexToken);

    const target = expected[2]; // cancel the 3rd occurrence
    await callFunction('cancelSessionInstance', { sessionId: id, instanceId: target, reason: 'one off' }, flexToken);
    // Cancelled + its ours-and-empty override deleted.
    expect((await instanceData(id, target))!.status).toBe('cancelled');
    expect((await getDb().collection('schedules').doc(flexTutorUid).collection('overrides').doc(target).get()).exists).toBe(false);

    // Run the real extend cron. Create-if-absent must SKIP the cancelled date
    // (its doc still exists) — no resurrection — while extending normally.
    const stats = await runExtendRecurring(getDb(), new Date());
    expect(stats.errors).toBe(0);

    const stillCancelled = await instanceData(id, target);
    expect(stillCancelled!.status).toBe('cancelled');
    expect(stillCancelled!.statusReason).toBe('cancelled_by_tutor');
    // No override was re-created for the cancelled date.
    expect((await getDb().collection('schedules').doc(flexTutorUid).collection('overrides').doc(target).get()).exists).toBe(false);
    // A sibling remains scheduled (the series is otherwise live).
    expect((await instanceData(id, expected[3]))!.status).toBe('scheduled');
  });
});
