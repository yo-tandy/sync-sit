import { createRequire } from 'module';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const require = createRequire(import.meta.url);
// Imported after `pnpm --filter study-functions build`.
const { runMarkSessionsCompleted } = require(
  '../../../apps/study-functions/dist/scheduled/markSessionsCompleted.js',
) as typeof import('../../../apps/study-functions/src/scheduled/markSessionsCompleted.js');

// Fixed injected clock: 2026-07-15T10:00Z is 12:00 Paris (CEST, UTC+2), so the
// Paris window is today=2026-07-15, yesterday=2026-07-14. All seed times are
// Paris wall-clock: 11:00 → 09:00Z (an hour before now); 14:00 → 12:00Z (two
// hours after now).
const NOW = new Date('2026-07-15T10:00:00Z');
const TODAY = '2026-07-15';
const YESTERDAY = '2026-07-14';
const FUTURE = '2026-07-22';

function fullGrid(): boolean[] {
  return new Array(96).fill(true);
}

describe('runMarkSessionsCompleted', () => {
  let seed: SeedData;
  let flexUid: string;

  const ssRef = (id: string) => getDb().collection('study-sessions').doc(id);
  const overrideRef = (uid: string, date: string) =>
    getDb().collection('schedules').doc(uid).collection('overrides').doc(date);

  async function seedOneTime(
    id: string,
    opts: { date: string; endTime: string; status?: string; tutorUserId?: string },
  ) {
    await ssRef(id).set({
      sessionId: id, tutorUserId: opts.tutorUserId ?? flexUid, familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid, subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Flex Tutor',
      type: 'one_time', date: opts.date, startTime: '10:00', endTime: opts.endTime,
      sessionLengthMinutes: 60, location: 'online', paddingMinutes: 0,
      status: opts.status ?? 'confirmed', createdAt: new Date(), updatedAt: new Date(),
    });
  }

  async function seedSeries(
    id: string,
    opts: { endDate?: string; status?: string },
  ) {
    const doc: Record<string, unknown> = {
      sessionId: id, tutorUserId: flexUid, familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid, subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Flex Tutor',
      type: 'recurring', startTime: '10:00', sessionLengthMinutes: 60,
      recurringSlots: [{ day: 'wed', startTime: '10:00', endTime: '11:00' }],
      location: 'online', paddingMinutes: 0,
      status: opts.status ?? 'confirmed', createdAt: new Date(), updatedAt: new Date(),
    };
    if (opts.endDate) doc.endDate = opts.endDate;
    await ssRef(id).set(doc);
  }

  async function seedInstance(
    parentId: string,
    date: string,
    opts: { status: string; endTime: string; tutorUserId?: string },
  ) {
    await ssRef(parentId).collection('instances').doc(date).set({
      instanceId: date, sessionId: parentId, tutorUserId: opts.tutorUserId ?? flexUid,
      familyId: seed.family1Id, date, startTime: '10:00', endTime: opts.endTime,
      sessionLengthMinutes: 60, paddingMinutes: 0, subject: 'math', level: '6e',
      rate: 25, location: 'online', status: opts.status,
      createdAt: new Date(), updatedAt: new Date(),
    });
  }

  /** An "ours" override claiming [startIdx,endIdx) on a full-grid day. */
  async function seedOursOverride(
    date: string, sessionId: string, startIdx: number, endIdx: number, instanceId?: string,
  ) {
    const slots = fullGrid();
    for (let i = startIdx; i < endIdx; i++) slots[i] = false;
    const entry: Record<string, unknown> = { sessionId, startIdx, endIdx };
    if (instanceId) entry.instanceId = instanceId;
    await overrideRef(flexUid, date).set({
      date, type: 'custom', slots, sessionBlocks: [entry],
      appSource: 'study', reason: 'study_session', createdAt: new Date(), updatedAt: new Date(),
    });
  }

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    const db = getDb();
    flexUid = 'tutor-flex-complete';
    await db.collection('users').doc(flexUid).set({
      uid: flexUid, email: 'flexcomplete@ejm.org', status: 'active',
      firstName: 'Flex', lastName: 'Tutor', language: 'en',
      profiles: { tutor: { enrollmentComplete: true, searchable: true, paddingMin: 0 } },
      notifPrefs: {}, fcmTokens: [],
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    await db.collection('schedules').doc(flexUid).set({
      weekly: { mon: fullGrid(), tue: fullGrid(), wed: fullGrid(), thu: fullGrid(), fri: fullGrid(), sat: fullGrid(), sun: fullGrid() },
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const inst = await db.collectionGroup('instances').get();
    await Promise.all(inst.docs.map((d) => d.ref.delete()));
    const ss = await db.collection('study-sessions').get();
    await Promise.all(ss.docs.map((d) => d.ref.delete()));
    const ov = await db.collection('schedules').doc(flexUid).collection('overrides').get();
    await Promise.all(ov.docs.map((d) => d.ref.delete()));
  });

  // ── (a) one_time completion, exact endTime boundary ──

  it('completes a one_time whose endTime has passed and leaves one still in progress', async () => {
    await seedOneTime('past', { date: TODAY, endTime: '11:00' }); // 09:00Z, an hour ago
    await seedOneTime('future', { date: TODAY, endTime: '14:00' }); // 12:00Z, in two hours
    await seedOneTime('yesterday', { date: YESTERDAY, endTime: '20:00' }); // clearly past

    const stats = await runMarkSessionsCompleted(getDb(), NOW);
    expect(stats.oneTimeCompleted).toBe(2);
    expect(stats.errors).toBe(0);

    expect((await ssRef('past').get()).data()!.status).toBe('completed');
    expect((await ssRef('past').get()).data()!.completedAt).toBeTruthy();
    expect((await ssRef('yesterday').get()).data()!.status).toBe('completed');
    // endTime two hours out → untouched.
    expect((await ssRef('future').get()).data()!.status).toBe('confirmed');
  });

  it('never touches cancelled or pending one_time sessions', async () => {
    await seedOneTime('cancelled', { date: TODAY, endTime: '11:00', status: 'cancelled' });
    await seedOneTime('pending', { date: TODAY, endTime: '11:00', status: 'pending' });

    const stats = await runMarkSessionsCompleted(getDb(), NOW);
    expect(stats.oneTimeCompleted).toBe(0);
    expect((await ssRef('cancelled').get()).data()!.status).toBe('cancelled');
    expect((await ssRef('pending').get()).data()!.status).toBe('pending');
  });

  // ── (b) instance completion + override pruning ──

  it('completes a past instance and PRUNES its override block (slot restored)', async () => {
    await seedSeries('series-b', { });
    await seedInstance('series-b', TODAY, { status: 'scheduled', endTime: '11:00' }); // passed
    await seedInstance('series-b', FUTURE, { status: 'scheduled', endTime: '11:00' }); // future date, out of window
    await seedOursOverride(TODAY, 'series-b', 44, 48, TODAY); // 11:00–12:00 block

    const stats = await runMarkSessionsCompleted(getDb(), NOW);
    expect(stats.instancesCompleted).toBe(1);
    expect(stats.errors).toBe(0);

    const done = (await ssRef('series-b').collection('instances').doc(TODAY).get()).data()!;
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBeTruthy();
    // ours + empty ledger + slots back to weekly → override DELETED (slot freed).
    expect((await overrideRef(flexUid, TODAY).get()).exists).toBe(false);

    // The out-of-window future instance is untouched.
    const future = (await ssRef('series-b').collection('instances').doc(FUTURE).get()).data()!;
    expect(future.status).toBe('scheduled');
  });

  it('leaves a scheduled instance whose endTime has not passed', async () => {
    await seedSeries('series-open', { });
    await seedInstance('series-open', TODAY, { status: 'scheduled', endTime: '14:00' }); // 12:00Z, future
    await seedOursOverride(TODAY, 'series-open', 44, 48, TODAY);

    const stats = await runMarkSessionsCompleted(getDb(), NOW);
    expect(stats.instancesCompleted).toBe(0);
    expect((await ssRef('series-open').collection('instances').doc(TODAY).get()).data()!.status).toBe('scheduled');
    // Override untouched.
    expect((await overrideRef(flexUid, TODAY).get()).exists).toBe(true);
  });

  // ── (c) series-parent completion — both negatives tested ──

  it('completes a recurring parent whose endDate passed AND has no scheduled instances left', async () => {
    // The last occurrence (yesterday) is still scheduled → (b) completes it, then
    // (c) sees zero scheduled remaining and completes the parent. Ordering proof.
    await seedSeries('series-done', { endDate: YESTERDAY });
    await seedInstance('series-done', YESTERDAY, { status: 'scheduled', endTime: '20:00' }); // passed

    const stats = await runMarkSessionsCompleted(getDb(), NOW);
    expect(stats.instancesCompleted).toBe(1);
    expect(stats.seriesCompleted).toBe(1);

    const parent = (await ssRef('series-done').get()).data()!;
    expect(parent.status).toBe('completed');
    expect(parent.completedAt).toBeTruthy();
  });

  it('does NOT complete a parent past endDate that still has a scheduled instance', async () => {
    await seedSeries('series-live', { endDate: YESTERDAY });
    // A future scheduled instance (out of the completion window) keeps the series alive.
    await seedInstance('series-live', FUTURE, { status: 'scheduled', endTime: '11:00' });

    const stats = await runMarkSessionsCompleted(getDb(), NOW);
    expect(stats.seriesCompleted).toBe(0);
    expect((await ssRef('series-live').get()).data()!.status).toBe('confirmed');
  });

  it('does NOT complete a parent whose endDate has not yet passed', async () => {
    await seedSeries('series-future-end', { endDate: '2026-08-01' }); // after today
    // Zero scheduled instances, but endDate is still in the future.
    const stats = await runMarkSessionsCompleted(getDb(), NOW);
    expect(stats.seriesCompleted).toBe(0);
    expect((await ssRef('series-future-end').get()).data()!.status).toBe('confirmed');
  });

  it('does NOT complete an open-ended parent (no endDate)', async () => {
    await seedSeries('series-open-ended', { });
    const stats = await runMarkSessionsCompleted(getDb(), NOW);
    expect(stats.seriesCompleted).toBe(0);
    expect((await ssRef('series-open-ended').get()).data()!.status).toBe('confirmed');
  });

  // ── Per-doc isolation: one poisoned doc cannot abort the run ──

  it('isolates a poisoned instance — siblings still complete, error counted', async () => {
    await seedSeries('series-ok', { });
    await seedInstance('series-ok', TODAY, { status: 'scheduled', endTime: '11:00' });
    await seedOursOverride(TODAY, 'series-ok', 44, 48, TODAY);
    // Poison: an empty tutorUserId makes the schedule lookup throw (invalid doc path).
    await seedSeries('series-poison', { });
    await seedInstance('series-poison', TODAY, { status: 'scheduled', endTime: '11:00', tutorUserId: '' });

    const stats = await runMarkSessionsCompleted(getDb(), NOW);
    expect(stats.errors).toBe(1);
    expect(stats.instancesCompleted).toBe(1);
    // The healthy instance completed despite the poisoned sibling.
    expect((await ssRef('series-ok').collection('instances').doc(TODAY).get()).data()!.status).toBe('completed');
  });
});
