import { createRequire } from 'module';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

const require = createRequire(import.meta.url);
// Imported after `pnpm --filter study-functions build`.
const { runExtendRecurring } = require(
  '../../../apps/study-functions/dist/scheduled/extendRecurring.js'
) as typeof import('../../../apps/study-functions/src/scheduled/extendRecurring.js');

// ── Pure date helpers (UTC calendar math — DST-immune) ──
const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
function parisDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
}
function incDate(s: string): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(s: string): string {
  return KEYS[new Date(`${s}T00:00:00Z`).getUTCDay()];
}
function addMin(t: string, min: number): string {
  const [h, m] = t.split(':').map(Number);
  const tot = h * 60 + m + min;
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
}
function schoolYearKey(s: string): string {
  const [y, mo] = s.split('-').map(Number);
  const start = mo >= 9 ? y : y - 1;
  return `${start}-${start + 1}`;
}
/** Candidate dates the cron expands from `anchor` (= parisDate(now)). */
function candidatesFrom(anchor: string, day: string, weeks: number, endDate?: string): string[] {
  let c = anchor;
  while (weekdayOf(c) !== day) c = incDate(c);
  const out: string[] = [];
  for (let w = 0; w < weeks; w++) {
    if (endDate && c > endDate) break;
    out.push(c);
    for (let k = 0; k < 7; k++) c = incDate(c);
  }
  return out;
}

describe('runExtendRecurring', () => {
  let seed: SeedData;
  let flexTutorUid: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    const db = getDb();
    flexTutorUid = 'tutor-flex-extend';
    const fullDay = new Array(96).fill(true);
    await db.collection('users').doc(flexTutorUid).set({
      uid: flexTutorUid, email: 'flexext@ejm.org', status: 'active',
      firstName: 'Flex', lastName: 'Extend', language: 'en',
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
    const ov = await db.collection('schedules').doc(flexTutorUid).collection('overrides').get();
    await Promise.all(ov.docs.map((d) => d.ref.delete()));
  });

  // ── Helpers ──
  async function seedSeries(opts: {
    day: string; startTime?: string; lengthMin?: number; endDate?: string;
    schoolWeeksOnly?: boolean; familyId?: string; recurringSlots?: unknown;
    trialFirstSession?: boolean;
  }): Promise<string> {
    const db = getDb();
    const now = new Date();
    const startTime = opts.startTime ?? '12:00';
    const len = opts.lengthMin ?? 60;
    const id = `ext-${Math.random().toString(36).slice(2, 10)}`;
    const doc: Record<string, unknown> = {
      sessionId: id, familyId: opts.familyId ?? seed.family1Id, tutorUserId: flexTutorUid,
      createdByUserId: seed.parent1.uid, subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Flex Extend',
      type: 'recurring', startTime, sessionLengthMinutes: len,
      recurringSlots:
        'recurringSlots' in opts
          ? opts.recurringSlots
          : [{ day: opts.day, startTime, endTime: addMin(startTime, len) }],
      schoolWeeksOnly: opts.schoolWeeksOnly ?? true,
      location: 'online', paddingMinutes: 0, status: 'confirmed',
      createdAt: now, updatedAt: now, confirmedAt: now,
    };
    if (opts.endDate) doc.endDate = opts.endDate;
    if (opts.trialFirstSession) doc.trialFirstSession = true;
    await db.collection('study-sessions').doc(id).set(doc);
    return id;
  }

  async function seedInstance(sessionId: string, date: string, startTime = '12:00'): Promise<void> {
    const db = getDb();
    const now = new Date();
    await db.collection('study-sessions').doc(sessionId).collection('instances').doc(date).set({
      instanceId: date, sessionId, familyId: seed.family1Id, tutorUserId: flexTutorUid,
      date, startTime, endTime: addMin(startTime, 60), sessionLengthMinutes: 60, paddingMinutes: 0,
      status: 'scheduled', subject: 'math', level: '6e', rate: 25, location: 'online',
      createdAt: now, updatedAt: now,
    });
  }

  async function instancesOf(sessionId: string) {
    const db = getDb();
    const snap = await db
      .collection('study-sessions').doc(sessionId).collection('instances').get();
    return snap.docs.map((d) => d.data());
  }

  /** A weekday whose first candidate from parisDate(now) is ≥ ~48h out. */
  function pickDay(now: Date): { anchor: string; day: string } {
    const anchor = parisDate(now);
    let d = anchor;
    for (let i = 0; i < 2; i++) d = incDate(d);
    return { anchor, day: weekdayOf(d) };
  }

  // ── Horizon maintenance: 4 weeks seeded → 8 after a run ──

  it('extends a series from 4 weeks of instances to the full 8-week horizon', async () => {
    const now = new Date();
    const { anchor, day } = pickDay(now);
    const cands = candidatesFrom(anchor, day, 8);
    const id = await seedSeries({ day });
    for (const d of cands.slice(0, 4)) await seedInstance(id, d);

    const stats = await runExtendRecurring(getDb(), now);
    expect(stats.instancesScheduled).toBe(4); // the 4 new ones

    const instances = await instancesOf(id);
    expect(instances.length).toBe(8);
    const dates = instances.map((i) => i.date).sort();
    expect(dates).toEqual([...cands].sort());
    for (const i of instances) expect(i.status).toBe('scheduled');
  });

  // ── Idempotent double-run: the second run creates nothing ──

  it('is idempotent — a second run creates no new instances or override entries', async () => {
    const db = getDb();
    const now = new Date();
    const { anchor, day } = pickDay(now);
    const cands = candidatesFrom(anchor, day, 8);
    const id = await seedSeries({ day });

    await runExtendRecurring(getDb(), now);
    const afterFirst = (await instancesOf(id)).length;
    expect(afterFirst).toBe(8);

    await runExtendRecurring(getDb(), now);
    const afterSecond = (await instancesOf(id)).length;
    expect(afterSecond).toBe(8);

    // The override ledger for a scheduled date has EXACTLY ONE entry for us (no
    // duplicate append across runs).
    const ov = (await db
      .collection('schedules').doc(flexTutorUid).collection('overrides').doc(cands[0]).get()).data()!;
    const mine = (ov.sessionBlocks as Array<Record<string, unknown>>).filter((b) => b.sessionId === id);
    expect(mine.length).toBe(1);
  });

  // ── endDate stops the horizon ──

  it('does not generate instances past endDate', async () => {
    const now = new Date();
    const { anchor, day } = pickDay(now);
    const cands = candidatesFrom(anchor, day, 8);
    const endDate = cands[4];
    const id = await seedSeries({ day, endDate });

    await runExtendRecurring(getDb(), now);
    const instances = await instancesOf(id);
    expect(instances.length).toBe(5); // cands[0..4]
    expect(instances.every((i) => (i.date as string) <= endDate)).toBe(true);
  });

  // ── New conflict_skip on a newly-blocked date + family notification ──

  it('marks a newly-conflicted date conflict_skip and notifies the family', async () => {
    const db = getDb();
    const now = new Date();
    const { anchor, day } = pickDay(now);
    const cands = candidatesFrom(anchor, day, 8);
    const conflictDate = cands[5];
    // A confirmed one_time on that date, overlapping 12:00–13:00.
    await db.collection('study-sessions').doc('ot-blocker-ext').set({
      sessionId: 'ot-blocker-ext', tutorUserId: flexTutorUid, familyId: seed.family2Id,
      type: 'one_time', status: 'confirmed', date: conflictDate,
      startTime: '12:00', endTime: '13:00', location: 'online', paddingMinutes: 0,
      sessionLengthMinutes: 60, createdAt: now, updatedAt: now,
    });
    const id = await seedSeries({ day });

    const stats = await runExtendRecurring(getDb(), now);
    expect(stats.instancesSkipped).toBe(1);

    const instances = await instancesOf(id);
    expect(instances.length).toBe(8);
    const skipped = instances.find((i) => i.date === conflictDate)!;
    expect(skipped.status).toBe('cancelled');
    expect(skipped.statusReason).toBe('conflict_skip');

    // Family (cancelled prefs) notified ONLY for the conflict.
    const notifs = await db
      .collection('notifications').where('type', '==', 'study_session_cancelled').get();
    expect(notifs.empty).toBe(false);
    expect(notifs.docs.some((d) => d.data().data?.sessionId === id)).toBe(true);
  });

  it('sends NO notification when every date schedules cleanly', async () => {
    const db = getDb();
    const now = new Date();
    const { day } = pickDay(now);
    const id = await seedSeries({ day });
    await runExtendRecurring(getDb(), now);
    const notifs = await db
      .collection('notifications').where('type', '==', 'study_session_cancelled').get();
    expect(notifs.docs.some((d) => d.data().data?.sessionId === id)).toBe(false);
  });

  // ── Trial flag is confirm-only: extension instances are NEVER flagged ──
  // (A confirmed series always has its first scheduled instance from confirm, so
  // the cron never materializes a series' first-ever occurrence. This pins that
  // even a trial series' cron-created instances carry no isTrial flag.)

  it('never flags extension instances as trial, even on a trial series', async () => {
    const now = new Date();
    const { day } = pickDay(now);
    const id = await seedSeries({ day, trialFirstSession: true });

    await runExtendRecurring(getDb(), now);
    const instances = await instancesOf(id);
    expect(instances.length).toBe(8);
    expect(instances.some((i) => i.isTrial === true)).toBe(false);
  });

  // ── Per-session isolation: a corrupt series can't block a healthy one ──

  it('isolates a corrupt series — the healthy one still extends', async () => {
    const now = new Date();
    const { anchor, day } = pickDay(now);
    const cands = candidatesFrom(anchor, day, 8);
    const corruptId = await seedSeries({ day, recurringSlots: [] }); // empty slots → throws in extendOne
    const healthyId = await seedSeries({ day });

    const stats = await runExtendRecurring(getDb(), now);
    expect(stats.errors).toBeGreaterThanOrEqual(1);

    expect((await instancesOf(healthyId)).length).toBe(8);
    expect((await instancesOf(corruptId)).length).toBe(0);
    // sanity — the healthy series covers the expected dates
    const dates = (await instancesOf(healthyId)).map((i) => i.date).sort();
    expect(dates).toEqual([...cands].sort());
  });

  // ── Holiday skip: a newly-entered holiday period drops the date (silent) ──

  it('drops a holiday-week occurrence entirely and sends no notification', async () => {
    const db = getDb();
    const now = new Date();
    const { anchor, day } = pickDay(now);
    const cands = candidatesFrom(anchor, day, 8);
    const holidayDate = cands[3];
    await db.collection('holidays').doc(schoolYearKey(holidayDate)).set({
      periods: [{ name: 'Test Break', startDate: holidayDate, endDate: holidayDate }],
    });
    const id = await seedSeries({ day, schoolWeeksOnly: true });

    await runExtendRecurring(getDb(), now);
    const instances = await instancesOf(id);
    expect(instances.length).toBe(7); // holiday date got NOTHING
    expect(instances.find((i) => i.date === holidayDate)).toBeUndefined();
    const notifs = await db
      .collection('notifications').where('type', '==', 'study_session_cancelled').get();
    expect(notifs.docs.some((d) => d.data().data?.sessionId === id)).toBe(false);
  });
});
