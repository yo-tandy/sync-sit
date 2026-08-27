import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

/**
 * modifySession + acknowledgeSessionModification (issue #234, parity A1).
 *
 * The load-bearing property is the LEDGER MOVE on a confirmed time change:
 * one transaction restores the old claim, re-checks the new time against
 * current availability, and claims it -- so the override docs, not just the
 * session doc, are asserted throughout. And a modify must NEVER look like a
 * cancel: lateCancellation stays unset no matter how close the old time was.
 */

// Two fixed far-future Mondays matching tutor2's weekly grid (Mon 16:00-20:00
// -> slots 64..79 true).
const FUTURE_MON = '2027-06-07';
const FUTURE_MON_2 = '2027-06-14';

function weeklyMonGrid(): boolean[] {
  const g = new Array(96).fill(false);
  for (let i = 64; i < 80; i++) g[i] = true;
  return g;
}

describe('modifySession', () => {
  let seed: SeedData;
  let parent1Token: string; // parent of family1 (the session's family)
  let parent3Token: string; // parent of family2 (a stranger)
  let tutor2Token: string;  // the session's tutor

  async function seedSession(over: Record<string, unknown> = {}): Promise<string> {
    const db = getDb();
    const id = (over.sessionId as string) ?? `sess-${Math.random().toString(36).slice(2, 9)}`;
    await db.collection('study-sessions').doc(id).set({
      sessionId: id,
      tutorUserId: seed.tutor2.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Yael Cohen',
      type: 'one_time',
      date: FUTURE_MON,
      startTime: '16:00',
      endTime: '17:00',
      sessionLengthMinutes: 60,
      location: 'online',
      paddingMinutes: 0,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    });
    return id;
  }

  /** A study-owned override doc claiming [startIdx,endIdx) for sessionId. */
  async function seedClaim(date: string, sessionId: string, startIdx: number, endIdx: number) {
    const slots = weeklyMonGrid();
    for (let i = startIdx; i < endIdx; i++) slots[i] = false;
    await overrideRef(date).set({
      date, type: 'custom', slots,
      sessionBlocks: [{ sessionId, startIdx, endIdx }],
      appSource: 'study', reason: 'study_session',
      createdAt: new Date(), updatedAt: new Date(),
    });
  }

  const overrideRef = (date: string) =>
    getDb().collection('schedules').doc(seed.tutor2.uid).collection('overrides').doc(date);

  const sessionData = async (id: string) =>
    (await getDb().collection('study-sessions').doc(id).get()).data()!;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    parent3Token = await getIdToken(seed.parent3.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    for (const coll of ['study-sessions', 'notifications']) {
      const snap = await db.collection(coll).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }
    const overrides = await db
      .collection('schedules').doc(seed.tutor2.uid).collection('overrides').get();
    await Promise.all(overrides.docs.map((d) => d.ref.delete()));
  });

  // ── Gates ──

  it('rejects the tutor -- only the family modifies; the tutor acknowledges', async () => {
    const id = await seedSession();
    await expect(
      callFunction('modifySession', { sessionId: id, startTime: '17:00' }, tutor2Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a parent from a different family', async () => {
    const id = await seedSession();
    await expect(
      callFunction('modifySession', { sessionId: id, startTime: '17:00' }, parent3Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects a recurring series with reason recurring_unsupported', async () => {
    // A recurring parent carries recurringSlots, not a date; pass a real slot
    // shape rather than date: undefined (Firestore set() rejects undefined).
    const id = await seedSession({
      type: 'recurring',
      recurringSlots: [{ day: 'mon', startTime: '16:00', endTime: '17:00' }],
    });
    await expect(
      callFunction('modifySession', { sessionId: id, startTime: '17:00' }, parent1Token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'recurring_unsupported' },
    });
  });

  it("rejects modifying the tutor's own pending proposal with reason proposal_not_modifiable", async () => {
    const id = await seedSession({ proposedBy: 'provider', createdByUserId: seed.tutor2.uid });
    await expect(
      callFunction('modifySession', { sessionId: id, startTime: '17:00' }, parent1Token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'proposal_not_modifiable' },
    });
  });

  it('rejects a cancelled session', async () => {
    const id = await seedSession({ status: 'cancelled' });
    await expect(
      callFunction('modifySession', { sessionId: id, startTime: '17:00' }, parent1Token),
    ).rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
  });

  it('returns modified:false on a no-op (same values sent back)', async () => {
    const id = await seedSession();
    const res = await callFunction<{ modified: boolean }>(
      'modifySession',
      { sessionId: id, startTime: '16:00', location: 'online' },
      parent1Token,
    );
    expect(res.modified).toBe(false);
    expect((await sessionData(id)).modified).toBeUndefined();
  });

  // ── Pending: plain update, no ledger involvement ──

  it('modifies a pending session WITHOUT flagging it, and without touching any override', async () => {
    const id = await seedSession();
    const res = await callFunction<{ modified: boolean; modifiedFields: string[] }>(
      'modifySession',
      { sessionId: id, startTime: '17:00', message: 'Running later now' },
      parent1Token,
    );
    expect(res.modified).toBe(true);
    expect(res.modifiedFields.sort()).toEqual(['message', 'startTime']);
    const s = await sessionData(id);
    expect(s.startTime).toBe('17:00');
    expect(s.endTime).toBe('18:00');
    expect(s.message).toBe('Running later now');
    // No modified flag on a pending: the tutor answers the UPDATED request,
    // so confirm/decline IS the acknowledgement -- a flag would have no
    // pending-card surface to clear it (PR #244 review).
    expect(s.modified).toBeUndefined();
    expect((await overrideRef(FUTURE_MON).get()).exists).toBe(false);
  });

  // ── Confirmed: the ledger move ──

  it('moves the claim on a same-date time change: old slots restored, new slots claimed', async () => {
    const id = await seedSession({ status: 'confirmed' });
    await seedClaim(FUTURE_MON, id, 40, 44); // 16:00-17:00 claimed
    await callFunction('modifySession', { sessionId: id, startTime: '18:00' }, parent1Token);

    const ov = (await overrideRef(FUTURE_MON).get()).data()!;
    const slots = ov.slots as boolean[];
    // Old block (16:00-17:00 = 64..68) back to the weekly true; new block
    // (18:00-19:00 = 72..76) claimed false.
    for (let i = 64; i < 68; i++) expect(slots[i]).toBe(true);
    for (let i = 72; i < 76; i++) expect(slots[i]).toBe(false);
    expect(ov.sessionBlocks).toEqual([{ sessionId: id, startIdx: 72, endIdx: 76 }]);

    const s = await sessionData(id);
    expect(s.startTime).toBe('18:00');
    expect(s.endTime).toBe('19:00');
    expect(s.modified).toBe(true);
  });

  it('moves the claim across dates: old override restored away, new date claimed', async () => {
    const id = await seedSession({ status: 'confirmed' });
    await seedClaim(FUTURE_MON, id, 64, 68);
    await callFunction('modifySession', { sessionId: id, date: FUTURE_MON_2 }, parent1Token);

    // Old date: our claim was the doc's only reason to exist -> restored away.
    expect((await overrideRef(FUTURE_MON).get()).exists).toBe(false);
    const nov = (await overrideRef(FUTURE_MON_2).get()).data()!;
    expect(nov.sessionBlocks).toEqual([{ sessionId: id, startIdx: 64, endIdx: 68 }]);
    expect((await sessionData(id)).date).toBe(FUTURE_MON_2);
  });

  it('refuses a move onto another confirmed session with reason time_unavailable, ledger untouched', async () => {
    const other = await seedSession({ status: 'confirmed', startTime: '18:00', endTime: '19:00' });
    const id = await seedSession({ status: 'confirmed' });
    await seedClaim(FUTURE_MON, id, 64, 68);
    await expect(
      callFunction('modifySession', { sessionId: id, startTime: '18:00' }, parent1Token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'time_unavailable' },
    });
    // Nothing moved: the session and its claim are exactly as seeded.
    const s = await sessionData(id);
    expect(s.startTime).toBe('16:00');
    expect(s.modified).toBeUndefined();
    const ov = (await overrideRef(FUTURE_MON).get()).data()!;
    expect(ov.sessionBlocks).toEqual([{ sessionId: id, startIdx: 64, endIdx: 68 }]);
    void other;
  });

  it('refuses moving inside the 24h notice window', async () => {
    const id = await seedSession({ status: 'confirmed' });
    await seedClaim(FUTURE_MON, id, 64, 68);
    const today = new Date().toISOString().slice(0, 10);
    await expect(
      callFunction('modifySession', { sessionId: id, date: today }, parent1Token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'time_unavailable' },
    });
  });

  it('auto-declines an overlapping pending from another family at the NEW time', async () => {
    const id = await seedSession({ status: 'confirmed' });
    await seedClaim(FUTURE_MON, id, 64, 68);
    const pendingId = await seedSession({
      familyId: seed.family2Id,
      createdByUserId: seed.parent3.uid,
      startTime: '18:00',
      endTime: '19:00',
    });
    await callFunction('modifySession', { sessionId: id, startTime: '18:00' }, parent1Token);
    const p = await sessionData(pendingId);
    expect(p.status).toBe('declined');
    expect(p.statusReason).toBe('slot_taken');
  });

  it('a location change alone moves the claim to a WIDER padded block (travel padding)', async () => {
    // paddedBlock pads only PADDED_LOCATIONS (travel/prep); online pads
    // nothing. So online -> family_home with paddingMinutes: 30 is the one
    // case where the restored and claimed blocks have different widths
    // (PR #244 review).
    const id = await seedSession({ status: 'confirmed', paddingMinutes: 30, location: 'online' });
    await seedClaim(FUTURE_MON, id, 64, 68);
    await callFunction('modifySession', { sessionId: id, location: 'family_home' }, parent1Token);
    const ov = (await overrideRef(FUTURE_MON).get()).data()!;
    expect(ov.sessionBlocks).toEqual([{ sessionId: id, startIdx: 62, endIdx: 70 }]);
    const slots = ov.slots as boolean[];
    for (let i = 62; i < 70; i++) expect(slots[i]).toBe(false);
    expect((await sessionData(id)).location).toBe('family_home');
  });

  it('re-denormalizes students on a roster change, and rejects a kid from another family', async () => {
    const id = await seedSession();
    await callFunction('modifySession', { sessionId: id, studentIds: ['kid1', 'kid2'] }, parent1Token);
    const s = await sessionData(id);
    expect(s.studentIds).toEqual(['kid1', 'kid2']);
    expect(s.students).toHaveLength(2);
    await expect(
      callFunction('modifySession', { sessionId: id, studentIds: ['kid4'] }, parent1Token),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a modify that would run past midnight', async () => {
    const id = await seedSession();
    await expect(
      callFunction('modifySession', { sessionId: id, startTime: '23:45', sessionLengthMinutes: 75 }, parent1Token),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('enforces the per-slot location trust boundary with reason location_not_offered', async () => {
    const id = await seedSession({ status: 'confirmed' });
    await seedClaim(FUTURE_MON, id, 64, 68);
    await expect(
      callFunction('modifySession', { sessionId: id, location: 'library' }, parent1Token),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'location_not_offered' },
    });
  });

  it('refuses a PENDING move onto an occupied slot (pre-check negative)', async () => {
    // Round 1 added the pending availability pre-check; this is its negative
    // pin -- stubbing the check out must fail here (PR #244 round 2). The
    // single-date grid subtracts CONFIRMED sessions, so seed one at 18:00.
    await seedSession({ status: 'confirmed', startTime: '18:00', endTime: '19:00' });
    const id = await seedSession(); // pending, 16:00
    await expect(
      callFunction('modifySession', { sessionId: id, startTime: '18:00' }, parent1Token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'time_unavailable' },
    });
    expect((await sessionData(id)).startTime).toBe('16:00');
  });

  it('refuses a length the tutor does not offer, grandfathering the stored one', async () => {
    // tutor2 offers [45, 60]; 75 is globally valid but not THEIR offering.
    const id = await seedSession();
    await expect(
      callFunction('modifySession', { sessionId: id, sessionLengthMinutes: 75 }, parent1Token),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'length_not_offered' },
    });
    // The stored length rides along untouched when other fields change.
    await callFunction('modifySession', { sessionId: id, startTime: '17:00' }, parent1Token);
    expect((await sessionData(id)).sessionLengthMinutes).toBe(60);
  });

  it("refuses moving a confirmed session inside the tutor's cancellation notice window", async () => {
    // 48h policy, session ~24h+ out: a cancel now would be LATE, so the move
    // is refused the same way -- modify must not be an escape hatch from the
    // policy (PR #244 round 2's decision point, taken as a guard).
    const soon = new Date(Date.now() + 30 * 60 * 60 * 1000); // ~30h out
    const soonDate = soon.toISOString().slice(0, 10);
    const id = await seedSession({
      status: 'confirmed',
      date: soonDate,
      cancellationNoticeHours: 48,
    });
    await expect(
      callFunction('modifySession', { sessionId: id, date: FUTURE_MON_2 }, parent1Token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { reason: 'inside_notice_window' },
    });
  });

  it('a second modify before acknowledgement UNIONS the field lists', async () => {
    const id = await seedSession({ status: 'confirmed' });
    await seedClaim(FUTURE_MON, id, 64, 68);
    await callFunction('modifySession', { sessionId: id, startTime: '18:00' }, parent1Token);
    await callFunction('modifySession', { sessionId: id, message: 'also, side entrance' }, parent1Token);
    const s = await sessionData(id);
    expect([...s.modifiedFields].sort()).toEqual(['message', 'startTime']);
  });

  it('the union RESETS after acknowledgement -- acknowledged fields do not resurface', async () => {
    // The `session.modified ? ... : undefined` ternary is the belt to the
    // ack's suspenders: without it a modify-after-ack would re-report fields
    // the tutor already saw, and every other pin would stay green
    // (PR #244 round 3).
    const id = await seedSession({ status: 'confirmed' });
    await seedClaim(FUTURE_MON, id, 64, 68);
    await callFunction('modifySession', { sessionId: id, startTime: '18:00' }, parent1Token);
    // Simulate ack the way acknowledgeSessionModification writes it, but keep
    // the STALE modifiedFields behind, so only the ternary protects us.
    await getDb().collection('study-sessions').doc(id).update({
      modified: false,
      modifiedFields: ['startTime'],
    });
    await callFunction('modifySession', { sessionId: id, message: 'new note' }, parent1Token);
    const s = await sessionData(id);
    expect(s.modifiedFields).toEqual(['message']);
  });

  it('NEVER sets lateCancellation -- a modify is not a cancel', async () => {
    const id = await seedSession({ status: 'confirmed', cancellationNoticeHours: 48 });
    await seedClaim(FUTURE_MON, id, 64, 68);
    await callFunction('modifySession', { sessionId: id, startTime: '18:00' }, parent1Token);
    const s = await sessionData(id);
    expect(s.lateCancellation).toBeUndefined();
    expect(s.status).toBe('confirmed');
  });

  it('notifies the tutor with type study_session_modified', async () => {
    const id = await seedSession();
    await callFunction('modifySession', { sessionId: id, startTime: '17:00' }, parent1Token);
    const snap = await getDb()
      .collection('notifications')
      .where('recipientUserId', '==', seed.tutor2.uid)
      .where('type', '==', 'study_session_modified')
      .get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0].data().data.sessionId).toBe(id);
  });
});

describe('acknowledgeSessionModification', () => {
  let seed: SeedData;
  let parent1Token: string;
  let tutor2Token: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parent1Token = await getIdToken(seed.parent1.uid);
    tutor2Token = await getIdToken(seed.tutor2.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  async function seedModified(): Promise<string> {
    const db = getDb();
    const id = `sess-ack-${Math.random().toString(36).slice(2, 9)}`;
    await db.collection('study-sessions').doc(id).set({
      sessionId: id, tutorUserId: seed.tutor2.uid, familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid, subject: 'math', level: '6e', rate: 25,
      studentIds: ['kid1'], students: [{ firstName: 'Lucas', age: 6 }],
      familyName: 'Dupont', parentName: 'Marie Dupont', tutorName: 'Yael Cohen',
      type: 'one_time', date: '2027-06-07', startTime: '16:00', endTime: '17:00',
      sessionLengthMinutes: 60, location: 'online', paddingMinutes: 0,
      status: 'confirmed', modified: true, modifiedAt: new Date(),
      modifiedFields: ['startTime'], createdAt: new Date(), updatedAt: new Date(),
    });
    return id;
  }

  it('lets the session tutor clear the modification flag', async () => {
    const id = await seedModified();
    await callFunction('acknowledgeSessionModification', { sessionId: id }, tutor2Token);
    const s = (await getDb().collection('study-sessions').doc(id).get()).data()!;
    expect(s.modified).toBe(false);
    expect(s.modifiedFields).toEqual([]);
  });

  it('refuses anyone but the session tutor -- including the modifying family', async () => {
    const id = await seedModified();
    await expect(
      callFunction('acknowledgeSessionModification', { sessionId: id }, parent1Token),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
