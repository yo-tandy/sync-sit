import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Fixed far-future dates so the 24h notice window never zeroes them, chosen to
// line up with tutor2 (Yael)'s seeded weekly grid:
//   Mon 16:00–20:00 → slots 64..79 true
//   Sun 10:00–18:00 → slots 40..71 true
//   Sat            → empty (all false)
const MON = '2027-06-07'; // a Monday
const SUN = '2027-06-06'; // a Sunday
const SAT = '2027-06-05'; // a Saturday

type AvailabilityResponse = { dates: { date: string; slots: boolean[] }[] };

describe('getTutorAvailability', () => {
  let seed: SeedData;
  let parent1Token: string; // verified family1 (Dupont)
  let parent3Token: string; // unverified family2 (Martin)
  let tutor2Token: string;
  let noSchedTutorUid: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);

    // An approved tutor with NO schedules doc, for the absent-schedule case.
    const db = getDb();
    noSchedTutorUid = 'tutor-no-schedule';
    await db.collection('users').doc(noSchedTutorUid).set({
      uid: noSchedTutorUid, email: 'noschedule@ejm.org', status: 'active',
      firstName: 'No', lastName: 'Schedule', language: 'en',
      profiles: { tutor: {
        enrollmentComplete: true, ejemEmail: 'noschedule@ejm.org', searchable: true,
        approvedFamilies: [seed.family1Id], paddingMin: 15,
        subjects: [{ subject: 'math', levels: ['6e'], rate: 20 }],
        sessionLengthsMin: [60], locationPrefs: ['online'],
      } },
      notifPrefs: {}, fcmTokens: [],
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    // Approve family1 for tutor2 by default (happy path); negatives override this.
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [seed.family1Id],
    });
    // Clear tutor2's overrides and any confirmed sessions between tests.
    const overrides = await db
      .collection('schedules').doc(seed.tutor2.uid).collection('overrides').get();
    await Promise.all(overrides.docs.map((d) => d.ref.delete()));
    const sessions = await db.collection('study-sessions').get();
    await Promise.all(sessions.docs.map((d) => d.ref.delete()));
    // Reset any holiday config a prior test set on tutor2's schedule doc.
    await db.collection('schedules').doc(seed.tutor2.uid).update({
      holidayMode: FieldValue.delete(),
      holidaySchedules: FieldValue.delete(),
    });
  });

  // ── Gate negatives ──

  it('rejects unauthenticated calls', async () => {
    await expect(
      callFunction('getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: MON, endDate: MON }),
    ).rejects.toThrow();
  });

  it('rejects a non-parent caller with permission-denied', async () => {
    await expect(
      callFunction('getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: MON, endDate: MON }, tutor2Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an unverified family with permission-denied', async () => {
    await expect(
      callFunction('getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: MON, endDate: MON }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a verified family that is NOT approved by the tutor', async () => {
    const db = getDb();
    await db.collection('users').doc(seed.tutor2.uid).update({
      'profiles.tutor.approvedFamilies': [],
    });
    await expect(
      callFunction('getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: MON, endDate: MON }, parent1Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects an unknown tutor with not-found', async () => {
    await expect(
      callFunction('getTutorAvailability', { tutorUserId: 'no-such-tutor', startDate: MON, endDate: MON }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a tutor who has not completed enrollment (failed-precondition)', async () => {
    // tutor1 (Noa) is active but enrollmentComplete=false.
    await expect(
      callFunction('getTutorAvailability', { tutorUserId: seed.tutor1.uid, startDate: MON, endDate: MON }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  // ── Zod rejections ──

  it('rejects a malformed date with invalid-argument', async () => {
    await expect(
      callFunction('getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: '2027/06/07', endDate: MON }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects endDate before startDate with invalid-argument', async () => {
    await expect(
      callFunction('getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: '2027-06-10', endDate: '2027-06-05' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a range longer than 28 days with invalid-argument', async () => {
    await expect(
      callFunction('getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: '2027-06-01', endDate: '2027-07-15' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a calendar-impossible month with invalid-argument', async () => {
    await expect(
      callFunction('getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: '2026-13-01', endDate: '2026-13-01' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a calendar-impossible day with invalid-argument', async () => {
    await expect(
      callFunction('getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: '2026-02-30', endDate: '2026-02-30' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('accepts a span of exactly 28 days but rejects 29', async () => {
    // 2027-06-01 → 2027-06-29 is a 28-day difference (29 dates); one day more is 29.
    const ok = await callFunction<AvailabilityResponse>(
      'getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: '2027-06-01', endDate: '2027-06-29' }, parent1Token,
    );
    expect(ok.dates).toHaveLength(29);
    await expect(
      callFunction('getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: '2027-06-01', endDate: '2027-06-30' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  // ── Grid correctness ──

  it("returns tutor2's Monday grid (16:00–20:00 available)", async () => {
    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: MON, endDate: MON }, parent1Token,
    );
    expect(res.dates).toHaveLength(1);
    expect(res.dates[0].date).toBe(MON);
    const slots = res.dates[0].slots;
    expect(slots).toHaveLength(96);
    expect(slots[64]).toBe(true); // 16:00 available
    expect(slots[79]).toBe(true); // 19:45 available
    expect(slots[63]).toBe(false); // 15:45 unavailable
    expect(slots[80]).toBe(false); // 20:00 unavailable
    expect(slots[0]).toBe(false); // 00:00 unavailable
  });

  it('returns every date in range with the right per-weekday grid', async () => {
    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: SAT, endDate: MON }, parent1Token,
    );
    expect(res.dates.map((d) => d.date)).toEqual([SAT, SUN, MON]);
    const sat = res.dates.find((d) => d.date === SAT)!.slots;
    const sun = res.dates.find((d) => d.date === SUN)!.slots;
    expect(sat.every((s) => s === false)).toBe(true); // Saturday: no availability
    expect(sun[40]).toBe(true); // Sunday 10:00 available
    expect(sun[39]).toBe(false); // Sunday 09:45 unavailable
    expect(sun[72]).toBe(false); // Sunday 18:00 unavailable
  });

  // ── Overrides ──

  it('honors an "unavailable" override (whole day zeroed)', async () => {
    const db = getDb();
    await db.collection('schedules').doc(seed.tutor2.uid).collection('overrides').doc(MON).set({
      date: MON, type: 'unavailable', createdAt: new Date(),
    });
    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: MON, endDate: MON }, parent1Token,
    );
    expect(res.dates[0].slots.every((s) => s === false)).toBe(true);
  });

  it('honors a "custom" override grid instead of the weekly grid', async () => {
    const db = getDb();
    const custom = new Array(96).fill(false);
    custom[50] = true; // 12:30 only
    await db.collection('schedules').doc(seed.tutor2.uid).collection('overrides').doc(MON).set({
      date: MON, type: 'custom', slots: custom, createdAt: new Date(),
    });
    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: MON, endDate: MON }, parent1Token,
    );
    const slots = res.dates[0].slots;
    expect(slots[50]).toBe(true);
    expect(slots[64]).toBe(false); // weekly 16:00 no longer applies
  });

  // ── Holiday-period grid substitution ──

  it('substitutes the holiday grid for dates inside a holiday period', async () => {
    const db = getDb();
    // A holiday grid distinct from tutor2's weekly Monday (16:00–20:00): only 07:30.
    const holidayGrid = new Array(96).fill(false);
    holidayGrid[30] = true; // 07:30
    await db.collection('schedules').doc(seed.tutor2.uid).update({
      holidayMode: 'different',
      holidaySchedules: { TestBreak: { mon: holidayGrid } },
    });
    // June 2027 falls in school year 2026-2027; the period covers only MON.
    await db.collection('holidays').doc('2026-2027').set({
      schoolYear: '2026-2027', zone: 'C',
      periods: [{ name: 'TestBreak', startDate: MON, endDate: MON }],
      updatedAt: new Date(), updatedByUserId: seed.admin.uid,
    });

    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: SUN, endDate: MON }, parent1Token,
    );
    const mon = res.dates.find((d) => d.date === MON)!.slots;
    const sun = res.dates.find((d) => d.date === SUN)!.slots;
    // MON is inside the period → holiday grid, NOT the weekly 16:00–20:00.
    expect(mon[30]).toBe(true);
    expect(mon[64]).toBe(false);
    // SUN is outside the period → weekly Sunday grid (10:00–18:00).
    expect(sun[40]).toBe(true);

    await db.collection('holidays').doc('2026-2027').delete();
  });

  // ── Confirmed-session subtraction (defense-in-depth) ──

  it('subtracts a confirmed session from the grid', async () => {
    const db = getDb();
    await db.collection('study-sessions').doc('sess-1').set({
      sessionId: 'sess-1', tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
      status: 'confirmed', type: 'one_time', date: MON,
      startTime: '16:00', endTime: '17:00', location: 'online', paddingMinutes: 15,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: MON, endDate: MON }, parent1Token,
    );
    const slots = res.dates[0].slots;
    // online → no padding: 16:00–17:00 (slots 64..67) removed, 17:00 onward stays.
    expect(slots[64]).toBe(false);
    expect(slots[67]).toBe(false);
    expect(slots[68]).toBe(true);
  });

  // ── Privacy: response shape leaks nothing beyond boolean grids ──

  it('returns exactly {dates:[{date,slots}]} — no reasons or session info', async () => {
    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability', { tutorUserId: seed.tutor2.uid, startDate: MON, endDate: MON }, parent1Token,
    );
    expect(Object.keys(res)).toEqual(['dates']);
    expect(Object.keys(res.dates[0]).sort()).toEqual(['date', 'slots']);
  });

  // ── Absent schedule doc ──

  it('returns all-false grids when the tutor has no schedule doc', async () => {
    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability', { tutorUserId: noSchedTutorUid, startDate: MON, endDate: MON }, parent1Token,
    );
    expect(res.dates).toHaveLength(1);
    expect(res.dates[0].slots).toHaveLength(96);
    expect(res.dates[0].slots.every((s) => s === false)).toBe(true);
  });
});
