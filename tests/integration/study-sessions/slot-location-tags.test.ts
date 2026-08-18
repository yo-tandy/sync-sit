import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// Per-slot location tags (issue #166). tutor2 (Yael): weekly Mon 16:00-20:00
// (slots 64..79), locationPrefs ['online', 'family_home'], paddingMin 15.
// A 60-minute booking at 16:00 covers cells 64..67.
const FUTURE_MON = '2027-06-07';

type BookResponse = { sessionId: string };
type AvailabilityResponse = {
  dates: {
    date: string;
    slots: boolean[];
    locationRanges: { startIdx: number; endIdx: number; locations: string[] }[];
  }[];
};

describe('per-slot location tags (issue #166)', () => {
  let seed: SeedData;
  let parent1Token: string;
  let tutor2Token: string;

  const oneTimeInput = () => ({
    tutorUserId: seed.tutor2.uid,
    subject: 'math',
    level: '6e',
    date: FUTURE_MON,
    startTime: '16:00',
    sessionLengthMinutes: 60,
    location: 'family_home',
    studentIds: ['kid1'],
  });

  const recurringInput = () => ({
    tutorUserId: seed.tutor2.uid,
    subject: 'math',
    level: '6e',
    type: 'recurring',
    recurringSlot: { day: 'mon', startTime: '16:00' },
    schoolWeeksOnly: false,
    sessionLengthMinutes: 60,
    location: 'family_home',
    studentIds: ['kid1'],
  });

  const proposeInput = () => ({
    familyId: seed.family1Id,
    subject: 'math',
    level: '6e',
    date: FUTURE_MON,
    startTime: '16:00',
    sessionLengthMinutes: 60,
    location: 'family_home',
  });

  /** Sparse tag map for slots [startIdx, endIdx) on one day. */
  const tagCells = (startIdx: number, endIdx: number, locations: string[]) => {
    const cells: Record<string, string[]> = {};
    for (let i = startIdx; i < endIdx; i++) cells[String(i)] = locations;
    return cells;
  };

  const setMonTags = async (cells: Record<string, unknown>) => {
    await getDb()
      .collection('schedules')
      .doc(seed.tutor2.uid)
      .update({ weeklyLocations: { mon: cells } });
  };

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
    });
    // Reset tags, sessions, and overrides between tests.
    await db.collection('schedules').doc(seed.tutor2.uid).update({
      weeklyLocations: FieldValue.delete(),
    });
    for (const coll of ['study-sessions', 'notifications']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    const overrides = await db
      .collection('schedules').doc(seed.tutor2.uid).collection('overrides').get();
    await Promise.all(overrides.docs.map((d) => d.ref.delete()));
  });

  // ── bookSession one_time: the trust boundary ──

  it('allows a booking whose location is in the slot override', async () => {
    await setMonTags(tagCells(64, 80, ['family_home']));
    const res = await callFunction<BookResponse>('bookSession', oneTimeInput(), parent1Token);
    expect(res.sessionId).toBeTruthy();
  });

  it('denies a location the override excludes even though profile prefs allow it', async () => {
    // Profile prefs include family_home; the Monday range is tagged online-only.
    // details.reason is the client's cue to show a location-specific message
    // instead of the generic slot-taken one.
    await setMonTags(tagCells(64, 80, ['online']));
    await expect(
      callFunction('bookSession', oneTimeInput(), parent1Token),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'location_not_offered' },
    });
  });

  it('still allows the tagged location on the same tagged range', async () => {
    await setMonTags(tagCells(64, 80, ['online']));
    const res = await callFunction<BookResponse>(
      'bookSession',
      { ...oneTimeInput(), location: 'online' },
      parent1Token,
    );
    expect(res.sessionId).toBeTruthy();
  });

  it('falls back to profile prefs on a legacy doc without weeklyLocations', async () => {
    const res = await callFunction<BookResponse>('bookSession', oneTimeInput(), parent1Token);
    expect(res.sessionId).toBeTruthy();
  });

  it('tolerates junk weeklyLocations without throwing (falls back to prefs)', async () => {
    await setMonTags({
      abc: ['online'],
      '999': ['online'],
      '64': 'online',
      '65': ['zoom', 42],
    } as unknown as Record<string, string[]>);
    const res = await callFunction<BookResponse>('bookSession', oneTimeInput(), parent1Token);
    expect(res.sessionId).toBeTruthy();
  });

  it('rejects every location when the covered cells have disjoint overrides', async () => {
    // 16:00-16:30 online-only, 16:30-17:00 family-home-only: a 60-min session
    // spanning both has an empty effective set.
    await setMonTags({
      ...tagCells(64, 66, ['online']),
      ...tagCells(66, 68, ['family_home']),
    });
    await expect(
      callFunction('bookSession', oneTimeInput(), parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      callFunction('bookSession', { ...oneTimeInput(), location: 'online' }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  // ── Claim-ledger overrides must KEEP the tags (PR #185 blocker) ──
  // Confirming a session writes schedules/{uid}/overrides/{date} via
  // buildMergedOverride (reason 'study_session' + sessionBlocks) — a system
  // claim, NOT a tutor-authored date override. The weekly grid is still that
  // date's base, so the weekly tags must keep constraining bookings,
  // proposals, and the availability response.

  it('keeps enforcing tags on a date that carries a confirmed session', async () => {
    await setMonTags(tagCells(64, 80, ['online']));
    // Family books 16:00-17:00 online; the tutor confirms -> claim override.
    const first = await callFunction<BookResponse>(
      'bookSession',
      { ...oneTimeInput(), location: 'online' },
      parent1Token,
    );
    await callFunction(
      'respondToSession',
      { sessionId: first.sessionId, action: 'confirm' },
      tutor2Token,
    );
    const ov = (
      await getDb()
        .collection('schedules').doc(seed.tutor2.uid)
        .collection('overrides').doc(FUTURE_MON).get()
    ).data()!;
    expect(ov.reason).toBe('study_session'); // the scenario is the claim doc, not 'manual'

    // A second booking at 18:00 with a location the tags exclude is REJECTED
    // even though profile prefs allow it (pre-fix it was silently accepted).
    await expect(
      callFunction(
        'bookSession',
        { ...oneTimeInput(), startTime: '18:00' },
        parent1Token,
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'location_not_offered' },
    });

    // The tagged location still books on the same date.
    const second = await callFunction<BookResponse>(
      'bookSession',
      { ...oneTimeInput(), startTime: '18:00', location: 'online' },
      parent1Token,
    );
    expect(second.sessionId).toBeTruthy();

    // getTutorAvailability still narrows: the remaining bookable run
    // (16:00-17:00 is claimed) reports the online-only effective set.
    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability',
      { tutorUserId: seed.tutor2.uid, startDate: FUTURE_MON, endDate: FUTURE_MON },
      parent1Token,
    );
    const day = res.dates.find((d) => d.date === FUTURE_MON)!;
    expect(day.locationRanges).toEqual([
      { startIdx: 68, endIdx: 80, locations: ['online'] },
    ]);
  });

  it('treats a custom-override date as profile defaults (tags do not apply)', async () => {
    // Weekly Monday tags exclude family_home, but this DATE has a custom
    // override grid — override-day cells resolve to profile prefs (the
    // override/holiday tag dimension is an explicit follow-up).
    await setMonTags(tagCells(64, 80, ['online']));
    const slots = new Array(96).fill(false);
    for (let i = 64; i < 80; i++) slots[i] = true;
    await getDb()
      .collection('schedules').doc(seed.tutor2.uid)
      .collection('overrides').doc(FUTURE_MON)
      .set({ date: FUTURE_MON, type: 'custom', slots, reason: 'manual', createdAt: FieldValue.serverTimestamp() });
    const res = await callFunction<BookResponse>('bookSession', oneTimeInput(), parent1Token);
    expect(res.sessionId).toBeTruthy();
  });

  // ── bookSession recurring: validates against the WEEKLY cells ──

  it('denies a recurring series whose location the weekly cells exclude', async () => {
    await setMonTags(tagCells(64, 80, ['online']));
    await expect(
      callFunction('bookSession', recurringInput(), parent1Token),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'location_not_offered' },
    });
  });

  it('allows a recurring series matching the weekly cell tags', async () => {
    await setMonTags(tagCells(64, 80, ['online']));
    const res = await callFunction<BookResponse>(
      'bookSession',
      { ...recurringInput(), location: 'online' },
      parent1Token,
    );
    expect(res.sessionId).toBeTruthy();
  });

  // ── proposeSession: the tutor's own tags bind proposals too ──

  it('denies a tutor proposal whose location the slot override excludes', async () => {
    await setMonTags(tagCells(64, 80, ['online']));
    await expect(
      callFunction('proposeSession', proposeInput(), tutor2Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('allows a tutor proposal matching the slot override', async () => {
    await setMonTags(tagCells(64, 80, ['online']));
    const res = await callFunction<BookResponse>(
      'proposeSession',
      { ...proposeInput(), location: 'online' },
      tutor2Token,
    );
    expect(res.sessionId).toBeTruthy();
  });

  // ── getTutorAvailability: effective location ranges ──

  it('returns locationRanges split where the effective set changes', async () => {
    // Monday 16:00-20:00 = slots 64..80; tag 17:00-18:00 (68..72) online-only.
    await setMonTags(tagCells(68, 72, ['online']));
    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability',
      { tutorUserId: seed.tutor2.uid, startDate: FUTURE_MON, endDate: FUTURE_MON },
      parent1Token,
    );
    const day = res.dates.find((d) => d.date === FUTURE_MON)!;
    expect(day.locationRanges).toEqual([
      { startIdx: 64, endIdx: 68, locations: ['family_home', 'online'] },
      { startIdx: 68, endIdx: 72, locations: ['online'] },
      { startIdx: 72, endIdx: 80, locations: ['family_home', 'online'] },
    ]);
  });

  it('returns whole-run profile-defaults ranges for a legacy doc', async () => {
    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability',
      { tutorUserId: seed.tutor2.uid, startDate: FUTURE_MON, endDate: FUTURE_MON },
      parent1Token,
    );
    const day = res.dates.find((d) => d.date === FUTURE_MON)!;
    expect(day.locationRanges).toEqual([
      { startIdx: 64, endIdx: 80, locations: ['family_home', 'online'] },
    ]);
  });

  it('returns profile-defaults ranges on a custom-override date (tags do not apply)', async () => {
    await setMonTags(tagCells(64, 80, ['online']));
    const slots = new Array(96).fill(false);
    for (let i = 40; i < 44; i++) slots[i] = true; // 10:00-11:00 custom
    await getDb()
      .collection('schedules').doc(seed.tutor2.uid)
      .collection('overrides').doc(FUTURE_MON)
      .set({ date: FUTURE_MON, type: 'custom', slots, reason: 'manual', createdAt: FieldValue.serverTimestamp() });
    const res = await callFunction<AvailabilityResponse>(
      'getTutorAvailability',
      { tutorUserId: seed.tutor2.uid, startDate: FUTURE_MON, endDate: FUTURE_MON },
      parent1Token,
    );
    const day = res.dates.find((d) => d.date === FUTURE_MON)!;
    expect(day.locationRanges).toEqual([
      { startIdx: 40, endIdx: 44, locations: ['family_home', 'online'] },
    ]);
  });

  // ── Recurring-series claim variant (PR #185 blocker): a confirmed series
  // spreads claim overrides across every materialized occurrence date; the
  // weekly tags must keep applying on all of them. Runs LAST in this file: the
  // confirm materializes instances on near-term Mondays (subcollections the
  // beforeEach doc-deletes do not reach); their 2026 dates never collide with
  // FUTURE_MON and afterAll clearAll() removes them. ──

  it('keeps enforcing tags on the occurrence dates of a confirmed recurring series', async () => {
    await setMonTags(tagCells(64, 80, ['online']));
    const booked = await callFunction<BookResponse>(
      'bookSession',
      { ...recurringInput(), location: 'online' },
      parent1Token,
    );
    const confirm = await callFunction<{ scheduledDates?: string[] }>(
      'respondToSession',
      { sessionId: booked.sessionId, action: 'confirm' },
      tutor2Token,
    );
    const dates = confirm.scheduledDates ?? [];
    expect(dates.length).toBeGreaterThan(0);
    const occurrence = dates[dates.length - 1]; // far from the notice window
    const ov = (
      await getDb()
        .collection('schedules').doc(seed.tutor2.uid)
        .collection('overrides').doc(occurrence).get()
    ).data()!;
    expect(ov.reason).toBe('study_session');

    // A one_time booking at 18:00 on a claimed occurrence date still obeys
    // the weekly tags (pre-fix the claim doc reset them to profile prefs).
    await expect(
      callFunction(
        'bookSession',
        { ...oneTimeInput(), date: occurrence, startTime: '18:00' },
        parent1Token,
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'location_not_offered' },
    });
    const ok = await callFunction<BookResponse>(
      'bookSession',
      { ...oneTimeInput(), date: occurrence, startTime: '18:00', location: 'online' },
      parent1Token,
    );
    expect(ok.sessionId).toBeTruthy();
  });

  // ── Schedule-save batch semantics (PR #185 review item 3): the client saves
  // the grid and tags as ONE writeBatch — a set(merge) for the grid plus an
  // update() replacing the whole weeklyLocations field. This pin proves the
  // server-side commit contract that save relies on: writes in one commit
  // apply in order (the update's exists-precondition is satisfied by the set
  // before it, even on a doc created in that same commit) and update()
  // REPLACES the map (stale per-cell keys never deep-merge back). ──

  describe('schedule save batch semantics', () => {
    const scratchRef = () => getDb().collection('schedules').doc('batch-sem-test');

    afterAll(async () => {
      await scratchRef().delete();
    });

    it('set(merge) + update in one batch replaces weeklyLocations without resurrecting stale keys', async () => {
      const db = getDb();
      await scratchRef().set({
        userId: 'batch-sem-test',
        weekly: { mon: [true] },
        weeklyLocations: { mon: { '64': ['online'], '65': ['online'] } },
      });
      const batch = db.batch();
      batch.set(
        scratchRef(),
        { userId: 'batch-sem-test', weekly: { mon: [true, true] }, holidayMode: 'same' },
        { merge: true },
      );
      batch.update(scratchRef(), { weeklyLocations: { mon: { '64': ['family_home'] } } });
      await batch.commit();
      const data = (await scratchRef().get()).data()!;
      expect(data.weeklyLocations).toEqual({ mon: { '64': ['family_home'] } }); // '65' gone
      expect(data.weekly).toEqual({ mon: [true, true] });
      expect(data.holidayMode).toBe('same');
    });

    it('the update after set succeeds in one batch even when the doc is created by that set', async () => {
      await scratchRef().delete();
      const db = getDb();
      const batch = db.batch();
      batch.set(
        scratchRef(),
        { userId: 'batch-sem-test', weekly: { mon: [true] } },
        { merge: true },
      );
      batch.update(scratchRef(), { weeklyLocations: { mon: { '64': ['online'] } } });
      await batch.commit();
      const data = (await scratchRef().get()).data()!;
      expect(data.weeklyLocations).toEqual({ mon: { '64': ['online'] } });
      expect(data.weekly).toEqual({ mon: [true] });
    });
  });
});
