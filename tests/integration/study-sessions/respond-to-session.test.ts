import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Fixed far-future Monday matching tutor2's weekly grid (Mon 16:00–20:00 →
// slots 64..79 true). Far enough out that the 24h notice never trips.
const FUTURE_MON = '2027-06-07';

type AvailabilityResponse = { dates: { date: string; slots: boolean[] }[] };

// Paris date+startTime ~hours from now, aligned to a 15-min slot (for the
// stale-notice test, which needs a session inside the notice window).
function parisNear(hoursFromNow: number): { date: string; startTime: string; endTime: string } {
  const target = new Date(Date.now() + hoursFromNow * 3600 * 1000);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(target)) p[part.type] = part.value;
  const slot = Math.floor((Number(p.hour) * 60 + Number(p.minute)) / 15);
  const hhmm = (s: number) => `${String(Math.floor((s * 15) / 60) % 24).padStart(2, '0')}:${String((s * 15) % 60).padStart(2, '0')}`;
  return { date: `${p.year}-${p.month}-${p.day}`, startTime: hhmm(slot), endTime: hhmm(slot + 4) };
}

describe('respondToSession', () => {
  let seed: SeedData;
  let parent1Token: string; // verified family1 (Dupont)
  let tutor2Token: string; // the owning tutor

  interface SessionOverrides {
    sessionId?: string;
    familyId?: string;
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
      type: 'one_time',
      date: over.date ?? FUTURE_MON,
      startTime: over.startTime ?? '16:00',
      endTime: over.endTime ?? '17:00',
      sessionLengthMinutes: 60,
      location: over.location ?? 'online',
      paddingMinutes: over.paddingMinutes ?? 15,
      status: over.status ?? 'pending',
      createdAt: new Date(), updatedAt: new Date(),
    });
    return id;
  }

  const overrideRef = () =>
    getDb().collection('schedules').doc(seed.tutor2.uid).collection('overrides').doc(FUTURE_MON);

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);
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
    const overrides = await db
      .collection('schedules').doc(seed.tutor2.uid).collection('overrides').get();
    await Promise.all(overrides.docs.map((d) => d.ref.delete()));
    // Reset any holiday config a holiday-mode test set on tutor2 / the year doc.
    await db.collection('schedules').doc(seed.tutor2.uid).update({
      holidayMode: FieldValue.delete(),
      holidaySchedules: FieldValue.delete(),
    });
    const holidayDoc = db.collection('holidays').doc('2026-2027');
    if ((await holidayDoc.get()).exists) await holidayDoc.delete();
  });

  // ── Confirm: the claim ──

  it('confirms a session and writes a restorable override (block false, grid preserved, ledger entry)', async () => {
    const db = getDb();
    const id = await seedSession({ startTime: '16:00', endTime: '17:00', location: 'online' });

    const res = await callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token);
    expect(res).toMatchObject({ success: true });

    const session = (await db.collection('study-sessions').doc(id).get()).data()!;
    expect(session.status).toBe('confirmed');
    expect(session.confirmedAt).toBeTruthy();

    const ov = (await overrideRef().get()).data()!;
    expect(ov.type).toBe('custom');
    expect(ov.appSource).toBe('study');
    expect(ov.reason).toBe('study_session');
    // online → no padding: slots 64..67 (16:00–17:00) blocked false.
    expect(ov.slots[64]).toBe(false);
    expect(ov.slots[67]).toBe(false);
    // Weekly grid OUTSIDE the block preserved (68 = 17:00 still available).
    expect(ov.slots[68]).toBe(true);
    // A weekly-false slot stays false (10:00 = slot 40).
    expect(ov.slots[40]).toBe(false);
    // Restorable ledger entry for exactly this session's block.
    expect(ov.sessionBlocks).toEqual([{ sessionId: id, startIdx: 64, endIdx: 68 }]);
  });

  it('pads the blocked range for an in-person session', async () => {
    const id = await seedSession({ startTime: '16:00', endTime: '17:00', location: 'family_home', paddingMinutes: 15 });
    await callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token);
    const ov = (await overrideRef().get()).data()!;
    // 15-min padding = 1 slot each side → block 63..68 false, 62 and 69 free.
    expect(ov.slots[63]).toBe(false);
    expect(ov.slots[68]).toBe(false);
    expect(ov.slots[69]).toBe(true);
    expect(ov.sessionBlocks).toEqual([{ sessionId: id, startIdx: 63, endIdx: 69 }]);
  });

  // ── Decline: no schedule mutation ──

  it('declines a session and writes NO override', async () => {
    const db = getDb();
    const id = await seedSession();
    const res = await callFunction('respondToSession', { sessionId: id, action: 'decline' }, tutor2Token);
    expect(res).toMatchObject({ success: true });

    const session = (await db.collection('study-sessions').doc(id).get()).data()!;
    expect(session.status).toBe('declined');
    expect(session.statusReason).toBe('declined_by_tutor');
    expect((await overrideRef().get()).exists).toBe(false);
  });

  // ── Gate negatives ──

  it('rejects a non-owner tutor with permission-denied', async () => {
    const id = await seedSession();
    await expect(
      callFunction('respondToSession', { sessionId: id, action: 'confirm' }, parent1Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an unknown session with not-found', async () => {
    await expect(
      callFunction('respondToSession', { sessionId: 'no-such', action: 'confirm' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects responding to an already-resolved session with failed-precondition', async () => {
    const id = await seedSession({ status: 'confirmed' });
    await expect(
      callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('rejects an invalid action with invalid-argument', async () => {
    const id = await seedSession();
    await expect(
      callFunction('respondToSession', { sessionId: id, action: 'maybe' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  // ── Stale-notice re-check at confirm ──

  it('rejects confirming a session that is now inside the 24h window', async () => {
    const near = parisNear(2); // ~2h from now
    const id = await seedSession(near);
    await expect(
      callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      message: 'This request is too close to the session time',
    });
  });

  // ── Concurrency: the double-respond race ──

  it('lets exactly one of two concurrent confirms win', async () => {
    const id = await seedSession();
    const results = await Promise.allSettled([
      callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token),
      callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'FAILED_PRECONDITION' });
    expect((await getDb().collection('study-sessions').doc(id).get()).data()!.status).toBe('confirmed');
  });

  it('rejects a confirm whose block was already claimed by another confirmed session', async () => {
    // A pre-existing confirmed session (seeded directly → no auto-decline ran)
    // occupies 16:00–17:00; our pending overlaps at 16:30–17:30.
    await seedSession({ sessionId: 'confirmed-a', startTime: '16:00', endTime: '17:00', status: 'confirmed' });
    const id = await seedSession({ startTime: '16:30', endTime: '17:30' });
    await expect(
      callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      message: 'This time is no longer available',
    });
  });

  // ── Auto-decline of overlapping pendings ──

  it('auto-declines overlapping pendings on confirm and leaves non-overlapping ones', async () => {
    const db = getDb();
    const target = await seedSession({ startTime: '16:00', endTime: '17:00' });
    const overlap = await seedSession({
      sessionId: 'overlap', familyId: seed.family2Id, startTime: '16:30', endTime: '17:30',
    });
    const survivor = await seedSession({ sessionId: 'survivor', startTime: '19:00', endTime: '20:00' });

    await callFunction('respondToSession', { sessionId: target, action: 'confirm' }, tutor2Token);

    const overlapDoc = (await db.collection('study-sessions').doc(overlap).get()).data()!;
    expect(overlapDoc.status).toBe('declined');
    expect(overlapDoc.statusReason).toBe('slot_taken');

    const survivorDoc = (await db.collection('study-sessions').doc(survivor).get()).data()!;
    expect(survivorDoc.status).toBe('pending');

    // The bumped family (family2 → parent3) gets a cancelled notification.
    const notifs = await db.collection('notifications')
      .where('recipientUserId', '==', seed.parent3.uid).get();
    expect(notifs.size).toBeGreaterThanOrEqual(1);
    expect(notifs.docs.some((d) => d.data().type === 'study_session_declined')).toBe(true);
  });

  // ── Coexisting foreign override: AND-merge preserves it ──

  it('AND-merges into a pre-existing foreign override, preserving its slots and fields', async () => {
    const db = getDb();
    // A sit-style / manual override with some slots already false and NO
    // sessionBlocks ledger — opaque to us; we must preserve it.
    const slots = new Array(96).fill(true);
    slots[70] = false; // a pre-existing block outside our range
    slots[40] = false;
    await overrideRef().set({
      date: FUTURE_MON, type: 'custom', slots,
      reason: 'manual_block', appointmentId: 'apt-legacy', createdAt: new Date(),
    });

    const id = await seedSession({ startTime: '16:00', endTime: '17:00', location: 'online' });
    await callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token);

    const ov = (await overrideRef().get()).data()!;
    // Our block AND-ed to false.
    expect(ov.slots[64]).toBe(false);
    expect(ov.slots[67]).toBe(false);
    // Pre-existing false slots preserved.
    expect(ov.slots[70]).toBe(false);
    expect(ov.slots[40]).toBe(false);
    // A slot that was true and outside our block stays true.
    expect(ov.slots[68]).toBe(true);
    // Foreign identifying fields preserved (override is opaque to us).
    expect(ov.appointmentId).toBe('apt-legacy');
    expect(ov.reason).toBe('manual_block');
    // Our restorable ledger entry appended.
    expect(ov.sessionBlocks).toEqual([{ sessionId: id, startIdx: 64, endIdx: 68 }]);
  });

  // ── Loop-closer: getTutorAvailability reflects the claim ──

  it('closes the loop: getTutorAvailability shows the confirmed block as unavailable', async () => {
    const id = await seedSession({ startTime: '16:00', endTime: '17:00', location: 'online' });
    await callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token);

    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability',
      { tutorUserId: seed.tutor2.uid, startDate: FUTURE_MON, endDate: FUTURE_MON },
      parent1Token,
    );
    const slots = res.dates[0].slots;
    expect(slots[64]).toBe(false); // 16:00 now blocked
    expect(slots[67]).toBe(false); // 16:45 blocked
    expect(slots[68]).toBe(true); // 17:00 still free
  });

  // ── Requester notification ──

  it('notifies the requesting family on confirm (confirmed prefs)', async () => {
    const db = getDb();
    const id = await seedSession();
    await callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token);
    const notifs = await db.collection('notifications')
      .where('recipientUserId', '==', seed.parent1.uid).get();
    expect(notifs.docs.some((d) => d.data().type === 'study_session_confirmed')).toBe(true);
  });

  // ── Holiday coherence at confirm ──

  /** Put tutor2 into holidayMode 'different' with a Monday holiday grid covering
   * FUTURE_MON (June 2027 → school year 2026-2027). */
  async function seedHolidayMonday(mondayGrid: boolean[]) {
    const db = getDb();
    await db.collection('schedules').doc(seed.tutor2.uid).update({
      holidayMode: 'different',
      holidaySchedules: { Break: { mon: mondayGrid } },
    });
    await db.collection('holidays').doc('2026-2027').set({
      schoolYear: '2026-2027',
      periods: [{ name: 'Break', startDate: FUTURE_MON, endDate: FUTURE_MON }],
      updatedAt: new Date(),
    });
  }

  it('rejects confirming a slot the tutor\'s holiday schedule excludes (weekly allows it)', async () => {
    // Holiday grid excludes 16:00 (slot 64) though the weekly grid allows it;
    // only 08:00 (slot 32) is open that day.
    const holidayGrid = new Array(96).fill(false);
    holidayGrid[32] = true;
    await seedHolidayMonday(holidayGrid);

    const id = await seedSession({ startTime: '16:00', endTime: '17:00', location: 'online' });
    await expect(
      callFunction('respondToSession', { sessionId: id, action: 'confirm' }, tutor2Token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      message: 'This time is no longer available',
    });
  });

  it('blocks a second booking on a holiday date via the confirmed-sessions subtraction', async () => {
    // On holiday dates the override is invisible to availability (holidayGrid
    // supersedes custom overrides), so a confirmed session's OWN subtraction is
    // the operative double-booking guard. Holiday grid opens 16:00–19:00.
    const holidayGrid = new Array(96).fill(false);
    for (let i = 64; i < 76; i++) holidayGrid[i] = true; // 16:00–19:00
    await seedHolidayMonday(holidayGrid);

    // A confirmed session already occupies 16:00–17:00 (seeded directly).
    await seedSession({ sessionId: 'confirmed-holiday', startTime: '16:00', endTime: '17:00', status: 'confirmed' });

    const bookInput = (startTime: string) => ({
      tutorUserId: seed.tutor2.uid, subject: 'math', level: '6e',
      date: FUTURE_MON, startTime, sessionLengthMinutes: 60,
      location: 'online', studentIds: ['kid1'],
    });

    // Same slot as the confirmed session → blocked by confirmed-subtraction.
    await expect(
      callFunction('bookSession', bookInput('16:00'), parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: 'slot not available' });

    // A different holiday-open slot (17:00) with no confirmed session → bookable,
    // proving the holiday grid opens the window and only the taken slot is blocked.
    const ok = await callFunction<{ sessionId: string }>('bookSession', bookInput('17:00'), parent1Token);
    expect(ok.sessionId).toBeTruthy();
  });
});
