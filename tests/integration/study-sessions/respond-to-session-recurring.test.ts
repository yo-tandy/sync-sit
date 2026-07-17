import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// ── Pure date helpers (UTC-only calendar math — DST-immune, matches study-core) ──
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
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
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
function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
/** Current Paris wall-clock minutes-since-midnight. */
function parisNowMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')!.value);
  const m = Number(parts.find((p) => p.type === 'minute')!.value);
  return h * 60 + m;
}
/** The first date the confirm anchors expansion at: now+24h Paris. */
function fromDate(): string {
  return parisDateOf(new Date(Date.now() + 24 * 60 * 60 * 1000));
}
/** Candidate occurrence dates, mirroring expandRecurringDates (sans holidays). */
function candidatesFor(day: string, weeks: number, endDate?: string): string[] {
  let c = fromDate();
  while (weekdayOf(c) !== day) c = incDate(c);
  const out: string[] = [];
  for (let w = 0; w < weeks; w++) {
    if (endDate && c > endDate) break;
    out.push(c);
    for (let k = 0; k < 7; k++) c = incDate(c);
  }
  return out;
}

type ConfirmResponse = {
  success: boolean;
  confirmed?: boolean;
  scheduledDates?: string[];
  skippedDates?: string[];
};

describe('respondToSession — recurring confirm', () => {
  let seed: SeedData;
  let flexTutorUid: string;
  let flexToken: string;
  let tutor2Token: string;

  // A weekday whose FIRST occurrence is ≥ ~48h out (day after now+24h), so the
  // 24h notice never spuriously conflict-skips the first candidate.
  function testDay(): string {
    return weekdayOf(incDate(fromDate()));
  }

  async function seedRecurring(opts: {
    tutorUserId: string;
    day: string;
    startTime: string;
    lengthMin?: number;
    familyId?: string;
    schoolWeeksOnly?: boolean;
    location?: string;
    paddingMinutes?: number;
    endDate?: string;
  }): Promise<string> {
    const db = getDb();
    const now = new Date();
    const len = opts.lengthMin ?? 60;
    const endTime = addMin(opts.startTime, len);
    const id = `rec-${Math.random().toString(36).slice(2, 10)}`;
    const doc: Record<string, unknown> = {
      sessionId: id,
      familyId: opts.familyId ?? seed.family1Id,
      tutorUserId: opts.tutorUserId,
      createdByUserId: seed.parent1.uid,
      subject: 'math',
      level: '6e',
      rate: 25,
      studentIds: ['kid1'],
      students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont',
      parentName: 'Marie Dupont',
      tutorName: 'Flex Tutor',
      type: 'recurring',
      startTime: opts.startTime,
      sessionLengthMinutes: len,
      recurringSlots: [{ day: opts.day, startTime: opts.startTime, endTime }],
      schoolWeeksOnly: opts.schoolWeeksOnly ?? true,
      location: opts.location ?? 'online',
      paddingMinutes: opts.paddingMinutes ?? 0,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    if (opts.endDate) doc.endDate = opts.endDate;
    await db.collection('study-sessions').doc(id).set(doc);
    return id;
  }

  async function instancesOf(sessionId: string) {
    const db = getDb();
    const snap = await db
      .collection('study-sessions').doc(sessionId).collection('instances').get();
    return snap.docs.map((d) => d.data());
  }

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    tutor2Token = await getIdToken(seed.tutor2.uid);

    const db = getDb();
    flexTutorUid = 'tutor-flex-confirm';
    flexToken = await getIdToken(flexTutorUid);
    const fullDay = new Array(96).fill(true);
    await db.collection('users').doc(flexTutorUid).set({
      uid: flexTutorUid, email: 'flexconfirm@ejm.org', status: 'active',
      firstName: 'Flex', lastName: 'Tutor', language: 'en',
      profiles: { tutor: {
        enrollmentComplete: true, ejemEmail: 'flexconfirm@ejm.org', searchable: true,
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
    // Clear instances (subcollections survive parent deletion in the emulator, so
    // a collection-group sweep is REQUIRED or the CG claim query sees ghosts).
    const inst = await db.collectionGroup('instances').get();
    await Promise.all(inst.docs.map((d) => d.ref.delete()));
    for (const coll of ['study-sessions', 'notifications', 'holidays']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    for (const uid of [flexTutorUid, seed.tutor2.uid]) {
      const ov = await db.collection('schedules').doc(uid).collection('overrides').get();
      await Promise.all(ov.docs.map((d) => d.ref.delete()));
    }
  });

  // ── Exact 8-date generation + per-date ledger ──

  it('generates 8 scheduled instances with a per-date override ledger entry', async () => {
    const db = getDb();
    const day = testDay();
    const expected = candidatesFor(day, 8);
    const id = await seedRecurring({ tutorUserId: flexTutorUid, day, startTime: '12:00' });

    const res = await callFunction<ConfirmResponse>(
      'respondToSession', { sessionId: id, action: 'confirm' }, flexToken,
    );
    expect(res.confirmed).toBe(true);
    expect(res.scheduledDates).toEqual(expected);
    expect(res.skippedDates).toEqual([]);

    const parent = (await db.collection('study-sessions').doc(id).get()).data()!;
    expect(parent.status).toBe('confirmed');

    const instances = await instancesOf(id);
    expect(instances.length).toBe(8);
    const byDate = new Map(instances.map((i) => [i.date as string, i]));
    for (const date of expected) {
      const inst = byDate.get(date)!;
      expect(inst).toBeTruthy();
      expect(inst.instanceId).toBe(date); // instanceId === date
      expect(inst.status).toBe('scheduled');
      expect(inst.startTime).toBe('12:00');
      expect(inst.endTime).toBe('13:00');
      expect(inst.subject).toBe('math');
      expect(inst.rate).toBe(25);
      expect(inst.tutorUserId).toBe(flexTutorUid);
      expect(weekdayOf(date)).toBe(day);

      // Restorable override ledger with an instanceId-keyed block.
      const ov = (await db
        .collection('schedules').doc(flexTutorUid).collection('overrides').doc(date).get()).data()!;
      const entry = (ov.sessionBlocks as Array<Record<string, unknown>>).find(
        (b) => b.sessionId === id,
      )!;
      expect(entry).toBeTruthy();
      expect(entry.instanceId).toBe(date);
      expect(entry.startIdx).toBe(48); // 12:00
      expect(entry.endIdx).toBe(52); // 13:00
    }
  });

  // ── Notice window: a within-notice first occurrence rolls to next week ──

  it('drops a within-notice first occurrence entirely (rolls to next week, no cancelled gap)', async () => {
    const db = getDb();
    // slot.day == the weekday of now+24h (the anchor date). A startTime EARLIER
    // than now's wall time puts that first occurrence inside the precise 24h
    // window: it must be dropped ENTIRELY (no instance), NOT conflict_skipped.
    const day = weekdayOf(fromDate());
    const startMin = Math.floor(Math.max(0, parisNowMinutes() - 60) / 15) * 15;
    const startTime = toHHMM(startMin);
    const all = candidatesFor(day, 8); // all[0] is the within-notice anchor date
    const expected = all.slice(1); // first occurrence rolled to next week

    const id = await seedRecurring({ tutorUserId: flexTutorUid, day, startTime });
    const res = await callFunction<ConfirmResponse>(
      'respondToSession', { sessionId: id, action: 'confirm' }, flexToken,
    );

    expect(res.scheduledDates).toEqual(expected);
    expect(res.skippedDates).toEqual([]); // dropped, NOT skipped
    const instances = await instancesOf(id);
    expect(instances.length).toBe(expected.length);
    // The within-notice date has NO instance at all (no visible cancelled gap).
    expect(instances.find((i) => i.date === all[0])).toBeUndefined();
  });

  // ── Holiday-skip (schoolWeeksOnly): the holiday date gets NO instance ──

  it('drops a school-holiday occurrence entirely (no instance, 7 scheduled)', async () => {
    const db = getDb();
    const day = testDay();
    const all = candidatesFor(day, 8);
    const holidayDate = all[2];
    await db.collection('holidays').doc(schoolYearKey(holidayDate)).set({
      periods: [{ name: 'Test Break', startDate: holidayDate, endDate: holidayDate }],
    });
    const id = await seedRecurring({
      tutorUserId: flexTutorUid, day, startTime: '12:00', schoolWeeksOnly: true,
    });

    const res = await callFunction<ConfirmResponse>(
      'respondToSession', { sessionId: id, action: 'confirm' }, flexToken,
    );
    expect(res.scheduledDates).not.toContain(holidayDate);
    expect(res.scheduledDates!.length).toBe(7);

    const instances = await instancesOf(id);
    expect(instances.length).toBe(7); // holiday date got NOTHING
    expect(instances.find((i) => i.date === holidayDate)).toBeUndefined();
  });

  // ── conflict_skip: a confirmed one_time on week 3 → cancelled instance, no override ──

  it('conflict-skips a date blocked by a confirmed one_time (instance cancelled, no override)', async () => {
    const db = getDb();
    const day = testDay();
    const all = candidatesFor(day, 8);
    const conflictDate = all[2];
    // A confirmed one_time on that date, overlapping 12:00–13:00.
    await db.collection('study-sessions').doc('one-time-blocker').set({
      sessionId: 'one-time-blocker', tutorUserId: flexTutorUid, familyId: seed.family2Id,
      type: 'one_time', status: 'confirmed',
      date: conflictDate, startTime: '12:00', endTime: '13:00',
      location: 'online', paddingMinutes: 0, sessionLengthMinutes: 60,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const id = await seedRecurring({ tutorUserId: flexTutorUid, day, startTime: '12:00' });

    const res = await callFunction<ConfirmResponse>(
      'respondToSession', { sessionId: id, action: 'confirm' }, flexToken,
    );
    expect(res.scheduledDates!.length).toBe(7);
    expect(res.skippedDates).toEqual([conflictDate]);

    const instances = await instancesOf(id);
    expect(instances.length).toBe(8); // the conflict date DOES get a (cancelled) instance
    const skipped = instances.find((i) => i.date === conflictDate)!;
    expect(skipped.status).toBe('cancelled');
    expect(skipped.statusReason).toBe('conflict_skip');

    // The recurring confirm wrote NO override on the conflict date.
    const ov = await db
      .collection('schedules').doc(flexTutorUid).collection('overrides').doc(conflictDate).get();
    expect(ov.exists).toBe(false);
  });

  // ── All dates conflict → failed-precondition, parent stays pending, no instances ──

  it('leaves the parent pending when no date is bookable (failed-precondition)', async () => {
    const db = getDb();
    // tutor2 has an EMPTY Saturday grid → every Saturday is unavailable.
    const id = await seedRecurring({ tutorUserId: seed.tutor2.uid, day: 'sat', startTime: '16:00', paddingMinutes: 15 });

    await expect(
      callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });

    const parent = (await db.collection('study-sessions').doc(id).get()).data()!;
    expect(parent.status).toBe('pending'); // untouched
    const instances = await instancesOf(id);
    expect(instances.length).toBe(0); // rolled back
  });

  // ── Double-respond race: exactly one confirm wins ──

  it('serializes concurrent confirms — one wins, no duplicate instances', async () => {
    const db = getDb();
    const day = testDay();
    const id = await seedRecurring({ tutorUserId: flexTutorUid, day, startTime: '12:00' });

    const results = await Promise.allSettled([
      callFunction<ConfirmResponse>('respondToSession', { sessionId: id, action: 'confirm' }, flexToken),
      callFunction<ConfirmResponse>('respondToSession', { sessionId: id, action: 'confirm' }, flexToken),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const parent = (await db.collection('study-sessions').doc(id).get()).data()!;
    expect(parent.status).toBe('confirmed');
    const instances = await instancesOf(id);
    expect(instances.length).toBe(8); // not 16
  });

  // ── endDate truncation ──

  it('truncates the series at endDate', async () => {
    const day = testDay();
    const all = candidatesFor(day, 8);
    const endDate = all[4]; // 5th occurrence
    const id = await seedRecurring({ tutorUserId: flexTutorUid, day, startTime: '12:00', endDate });

    const res = await callFunction<ConfirmResponse>(
      'respondToSession', { sessionId: id, action: 'confirm' }, flexToken,
    );
    expect(res.scheduledDates!.length).toBe(5);
    expect(res.scheduledDates).toEqual(all.slice(0, 5));
    const instances = await instancesOf(id);
    expect(instances.length).toBe(5);
  });

  // ── Decline: no instances ──

  it('declines a recurring series without creating instances', async () => {
    const db = getDb();
    const day = testDay();
    const id = await seedRecurring({ tutorUserId: flexTutorUid, day, startTime: '12:00' });

    const res = await callFunction<ConfirmResponse>(
      'respondToSession', { sessionId: id, action: 'decline' }, flexToken,
    );
    expect(res.success).toBe(true);
    const parent = (await db.collection('study-sessions').doc(id).get()).data()!;
    expect(parent.status).toBe('declined');
    const instances = await instancesOf(id);
    expect(instances.length).toBe(0);
  });

  // ── Recurring vs recurring: a second series skips the first's dates via CG ──

  it('skips dates already held by another series (collection-group instance subtraction)', async () => {
    const db = getDb();
    const day = testDay();
    const all = candidatesFor(day, 8);

    // Series A: a SHORT series (ends at week 3) that grabs the first 3 dates.
    const aId = await seedRecurring({
      tutorUserId: flexTutorUid, day, startTime: '12:00', endDate: all[2],
    });
    const aRes = await callFunction<ConfirmResponse>(
      'respondToSession', { sessionId: aId, action: 'confirm' }, flexToken,
    );
    expect(aRes.scheduledDates!.length).toBe(3);

    // Delete A's override docs so the ONLY thing that can block series B on those
    // dates is A's scheduled INSTANCES (via the collection-group subtraction).
    for (const d of all.slice(0, 3)) {
      await db.collection('schedules').doc(flexTutorUid).collection('overrides').doc(d).delete();
    }

    // Series B: full 8-week series on the same slot, different family.
    const bId = await seedRecurring({
      tutorUserId: flexTutorUid, day, startTime: '12:00', familyId: seed.family2Id,
    });
    const bRes = await callFunction<ConfirmResponse>(
      'respondToSession', { sessionId: bId, action: 'confirm' }, flexToken,
    );
    // B schedules only weeks 4-8; weeks 1-3 conflict with A's instances.
    expect(bRes.scheduledDates).toEqual(all.slice(3));
    expect(bRes.skippedDates).toEqual(all.slice(0, 3));

    const bInstances = await instancesOf(bId);
    for (const d of all.slice(0, 3)) {
      const inst = bInstances.find((i) => i.date === d)!;
      expect(inst.status).toBe('cancelled');
      expect(inst.statusReason).toBe('conflict_skip');
    }
  });
});
