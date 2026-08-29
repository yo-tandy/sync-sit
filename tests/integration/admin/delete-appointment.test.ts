import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

/**
 * `admin/deleteAppointment` — issue #408 item 4.
 *
 * The appointment was hard-deleted and the babysitter's `sessionBlocks` claim
 * was left behind, so the slot stayed permanently unavailable with nothing in
 * the system pointing at it. This suite is the first coverage the callable has
 * had at all, so it pins the surrounding behaviour (auth, the cascade, the
 * audit entry) alongside the fix.
 */
describe('deleteAppointment', () => {
  let seed: SeedData;
  let adminToken: string;

  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  /** A date 9 days out — comfortably future, and stable across a run. */
  const DATE = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  /** An all-available weekly grid, so a released claim restores to exactly it
   *  and the override doc is DELETED — an unambiguous "the slot came back". */
  async function seedOpenSchedule(uid: string): Promise<void> {
    const weekly: Record<string, boolean[]> = {};
    for (const key of DAY_KEYS) weekly[key] = new Array(96).fill(true);
    await getDb().collection('schedules').doc(uid).set({ userId: uid, weekly });
  }

  /**
   * An override in the shape a confirm leaves behind: every `blocks` range
   * AND-ed to false with a matching `sessionBlocks` ledger entry. `entries`
   * empty models a LEGACY pre-ledger override.
   */
  async function seedOverride(
    uid: string,
    date: string,
    ranges: Array<[number, number]>,
    entries: Record<string, unknown>[],
    provenance: { appSource: string; reason: string } = {
      appSource: 'sit',
      reason: 'appointment',
    },
  ): Promise<void> {
    const slots = new Array(96).fill(true);
    for (const [start, end] of ranges) for (let i = start; i < end; i++) slots[i] = false;
    await getDb()
      .collection('schedules').doc(uid)
      .collection('overrides').doc(date)
      .set({
        date, type: 'custom', slots, sessionBlocks: entries,
        ...provenance,
        createdAt: new Date(), updatedAt: new Date(),
      });
  }

  async function readOverride(uid: string, date: string) {
    return getDb().collection('schedules').doc(uid).collection('overrides').doc(date).get();
  }

  async function readAudit(appointmentId: string) {
    const snap = await getDb().collection('auditLogs')
      .where('action', '==', 'delete_appointment')
      .get();
    return snap.docs
      .map((d) => d.data())
      .find((d) => d.details?.appointmentId === appointmentId);
  }

  beforeEach(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
    await seedOpenSchedule(seed.babysitter1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  it('deletes a CONFIRMED appointment and hands the slot back to the babysitter', async () => {
    const db = getDb();
    const appointmentId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
      date: DATE,
    });
    await seedOverride(seed.babysitter1.uid, DATE, [[32, 40]], [
      { startIdx: 32, endIdx: 40, appointmentId },
    ]);

    const result = await callFunction<{ success: boolean }>(
      'deleteAppointment',
      { appointmentId },
      adminToken,
    );
    expect(result.success).toBe(true);

    expect((await db.collection('appointments').doc(appointmentId).get()).exists).toBe(false);
    // The override held nothing else, so the day reverts to the bare weekly
    // grid and the doc goes with it.
    expect((await readOverride(seed.babysitter1.uid, DATE)).exists).toBe(false);
    expect((await readAudit(appointmentId))!.details.scheduleClaimReleased).toBe(true);
  });

  it('conserves a cross-app STUDY claim on the same date', async () => {
    const appointmentId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
      date: DATE,
    });
    // One date, two claims: this appointment at 08:00–10:00 and a tutoring
    // session at 11:00–13:00, the dual-role student case the shared inverse
    // exists for.
    await seedOverride(
      seed.babysitter1.uid,
      DATE,
      [[32, 40], [44, 52]],
      [
        { startIdx: 32, endIdx: 40, appointmentId },
        { startIdx: 44, endIdx: 52, sessionId: 'study-session-1' },
      ],
    );

    await callFunction('deleteAppointment', { appointmentId }, adminToken);

    const override = await readOverride(seed.babysitter1.uid, DATE);
    expect(override.exists).toBe(true);
    const data = override.data()!;
    // Only the appointment's own entry left the ledger.
    expect(data.sessionBlocks).toEqual([
      { startIdx: 44, endIdx: 52, sessionId: 'study-session-1' },
    ]);
    // Its slots reopened...
    expect((data.slots as boolean[]).slice(32, 40).every((s) => s === true)).toBe(true);
    // ...and the study session's stayed blocked.
    expect((data.slots as boolean[]).slice(44, 52).every((s) => s === false)).toBe(true);
  });

  it('leaves a LEGACY ledgerless override untouched', async () => {
    const appointmentId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
      date: DATE,
    });
    // A pre-H3 override: slots blocked, no `sessionBlocks` to match. Nothing
    // can tell which slots this appointment holds, so the conservative rule is
    // to change nothing.
    await seedOverride(seed.babysitter1.uid, DATE, [[32, 40]], []);

    await callFunction('deleteAppointment', { appointmentId }, adminToken);

    const data = (await readOverride(seed.babysitter1.uid, DATE)).data()!;
    expect((data.slots as boolean[]).slice(32, 40).every((s) => s === false)).toBe(true);
    expect((await readAudit(appointmentId))!.details.scheduleClaimReleased).toBe(false);
  });

  it('collects a claim left behind on a CANCELLED appointment', async () => {
    // The predicate is the ledger entry, not the status. A cancel that failed
    // to release (issue #408 item 1 found `deleteUser` doing exactly that)
    // leaves a `cancelled` appointment still holding a claim — and that is the
    // claim an admin delete most needs to collect, because deleting the doc is
    // the last chance anything has to find it.
    const appointmentId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'cancelled',
      date: DATE,
    });
    await seedOverride(seed.babysitter1.uid, DATE, [[32, 40]], [
      { startIdx: 32, endIdx: 40, appointmentId },
    ]);

    await callFunction('deleteAppointment', { appointmentId }, adminToken);

    expect((await readOverride(seed.babysitter1.uid, DATE)).exists).toBe(false);
    expect((await readAudit(appointmentId))!.details.scheduleClaimReleased).toBe(true);
  });

  it('releases nothing for a PENDING appointment (it never claimed a slot)', async () => {
    const appointmentId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'pending',
      date: DATE,
    });
    // An unrelated claim on the same date must survive a pending delete.
    await seedOverride(seed.babysitter1.uid, DATE, [[32, 40]], [
      { startIdx: 32, endIdx: 40, appointmentId: 'some-other-appointment' },
    ]);

    await callFunction('deleteAppointment', { appointmentId }, adminToken);

    expect((await readOverride(seed.babysitter1.uid, DATE)).exists).toBe(true);
    expect((await readAudit(appointmentId))!.details.scheduleClaimReleased).toBe(false);
  });

  it('handles a confirmed RECURRING arrangement, which stores date: null', async () => {
    const db = getDb();
    const appointmentId = await seedAppointment({
      babysitterUserId: seed.babysitter1.uid,
      familyId: seed.family1Id,
      createdByUserId: seed.parent1.uid,
      status: 'confirmed',
      type: 'recurring',
    });
    await db.collection('appointments').doc(appointmentId).update({ date: null });

    const result = await callFunction<{ success: boolean }>(
      'deleteAppointment',
      { appointmentId },
      adminToken,
    );

    expect(result.success).toBe(true);
    expect((await db.collection('appointments').doc(appointmentId).get()).exists).toBe(false);
    expect((await readAudit(appointmentId))!.details.scheduleClaimReleased).toBe(false);
  });

  describe('errors', () => {
    it('rejects unauthenticated callers and leaves the appointment in place', async () => {
      const appointmentId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
        date: DATE,
      });
      await expect(
        callFunction('deleteAppointment', { appointmentId }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(
        (await getDb().collection('appointments').doc(appointmentId).get()).exists,
      ).toBe(true);
    });

    it('rejects a non-admin parent and leaves the appointment in place', async () => {
      const appointmentId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
        date: DATE,
      });
      const parentToken = await getIdToken(seed.parent1.uid);
      await expect(
        callFunction('deleteAppointment', { appointmentId }, parentToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      expect(
        (await getDb().collection('appointments').doc(appointmentId).get()).exists,
      ).toBe(true);
    });

    it('rejects a missing appointmentId', async () => {
      await expect(
        callFunction('deleteAppointment', {}, adminToken),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('returns not-found for an unknown appointment', async () => {
      await expect(
        callFunction('deleteAppointment', { appointmentId: 'no-such-appt' }, adminToken),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
