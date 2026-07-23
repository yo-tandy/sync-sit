import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

describe('respondToRequest', () => {
  let seed: SeedData;
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    babysitterToken = await getIdToken(seed.babysitter1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    // Clean up appointments between tests to avoid interference
    const db = getDb();
    const appts = await db.collection('appointments').get();
    await Promise.all(appts.docs.map((d) => d.ref.delete()));
  });

  describe('happy paths', () => {
    it('accepts a pending request', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
      });

      const result = await callFunction<{ success: boolean }>(
        'respondToRequest',
        { appointmentId: apptId, action: 'accept' },
        babysitterToken
      );

      expect(result.success).toBe(true);

      const doc = await getDb().collection('appointments').doc(apptId).get();
      expect(doc.data()!.status).toBe('confirmed');
      expect(doc.data()!.confirmedAt).toBeDefined();
    });

    it('declines a pending request', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
      });

      const result = await callFunction<{ success: boolean }>(
        'respondToRequest',
        { appointmentId: apptId, action: 'decline' },
        babysitterToken
      );

      expect(result.success).toBe(true);

      const doc = await getDb().collection('appointments').doc(apptId).get();
      expect(doc.data()!.status).toBe('rejected');
      expect(doc.data()!.statusReason).toBe('declined_by_babysitter');
    });

    it('creates schedule override when blockSchedule=true on accept', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        date: '2026-05-10',
        startTime: '18:00',
        endTime: '22:00',
      });

      await callFunction(
        'respondToRequest',
        { appointmentId: apptId, action: 'accept', blockSchedule: true },
        babysitterToken
      );

      const override = await getDb()
        .collection('schedules').doc(seed.babysitter1.uid)
        .collection('overrides').doc('2026-05-10')
        .get();
      expect(override.exists).toBe(true);
    });
  });

  // ── H3: sit schedule claims carry the restorable sessionBlocks ledger ──
  // A far-future Monday; babysitter1's Monday grid is 17:00–22:00 (slots 68..87).
  // An 18:00–20:00 appointment claims slots 72..79 (block [72,80)).
  describe('schedule ledger', () => {
    const MON = '2027-06-07';
    const overrideRef = () =>
      getDb().collection('schedules').doc(seed.babysitter1.uid)
        .collection('overrides').doc(MON);

    beforeEach(async () => {
      await overrideRef().delete().catch(() => {});
    });
    afterAll(async () => {
      await overrideRef().delete().catch(() => {});
    });

    it('writes a per-slot custom block with a sit ledger entry when no override exists', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        date: MON, startTime: '18:00', endTime: '20:00',
      });

      await callFunction(
        'respondToRequest',
        { appointmentId: apptId, action: 'accept', blockSchedule: true },
        babysitterToken
      );

      const doc = (await overrideRef().get()).data()!;
      // Provenance + ledger (the new, previously-missing record).
      expect(doc.appSource).toBe('sit');
      expect(doc.reason).toBe('appointment');
      expect(doc.sessionBlocks).toEqual([
        { appointmentId: apptId, startIdx: 72, endIdx: 80 },
      ]);
      // Slots: the appointment's own range blocked; the rest of the weekly-open
      // window (68..71, 80..87) stays available (NOT a whole-day block).
      const slots = doc.slots as boolean[];
      expect(slots[72]).toBe(false);
      expect(slots[79]).toBe(false);
      expect(slots[68]).toBe(true);
      expect(slots[80]).toBe(true);
      expect(slots[0]).toBe(false); // weekly-closed slot stays closed
    });

    it('merges the claim into an existing override, preserving its slots + fields', async () => {
      // A pre-existing (foreign/manual) custom override: all-true with a manual
      // block at slot 50, no ledger.
      const existingSlots = new Array(96).fill(true);
      existingSlots[50] = false;
      await overrideRef().set({
        date: MON, type: 'custom', slots: existingSlots,
        reason: 'manual_block', createdAt: new Date(), updatedAt: new Date(),
      });

      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        date: MON, startTime: '18:00', endTime: '20:00',
      });

      await callFunction(
        'respondToRequest',
        { appointmentId: apptId, action: 'accept', blockSchedule: true },
        babysitterToken
      );

      const doc = (await overrideRef().get()).data()!;
      const slots = doc.slots as boolean[];
      // Byte-identical to the old lossy merge: our range ANDed false...
      expect(slots[72]).toBe(false);
      expect(slots[79]).toBe(false);
      // ...pre-existing manual block preserved, unrelated slots preserved.
      expect(slots[50]).toBe(false);
      expect(slots[60]).toBe(true);
      // The foreign owner's reason is preserved (only-fill provenance).
      expect(doc.reason).toBe('manual_block');
      // ...but the sit claim is now RECORDED in the ledger.
      expect(doc.sessionBlocks).toEqual([
        { appointmentId: apptId, startIdx: 72, endIdx: 80 },
      ]);
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated calls', async () => {
      await expect(
        callFunction('respondToRequest', { appointmentId: 'apt-x', action: 'accept' })
      ).rejects.toThrow();
    });

    it('rejects missing appointmentId', async () => {
      await expect(
        callFunction('respondToRequest', { action: 'accept' }, babysitterToken)
      ).rejects.toThrow();
    });

    it('rejects non-existent appointment', async () => {
      await expect(
        callFunction(
          'respondToRequest',
          { appointmentId: 'does-not-exist', action: 'accept' },
          babysitterToken
        )
      ).rejects.toThrow();
    });

    it('rejects wrong babysitter (not assigned)', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid, // Lea's appointment
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
      });

      // babysitter3 (Camille) tries to respond
      const otherToken = await getIdToken(seed.babysitter3.uid);
      await expect(
        callFunction(
          'respondToRequest',
          { appointmentId: apptId, action: 'accept' },
          otherToken
        )
      ).rejects.toThrow();
    });
  });

  describe('edge cases', () => {
    it('rejects response to already-confirmed appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
      });

      await expect(
        callFunction(
          'respondToRequest',
          { appointmentId: apptId, action: 'accept' },
          babysitterToken
        )
      ).rejects.toThrow();
    });

    it('rejects response to already-rejected appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'rejected',
        statusReason: 'declined_by_babysitter',
      });

      await expect(
        callFunction(
          'respondToRequest',
          { appointmentId: apptId, action: 'decline' },
          babysitterToken
        )
      ).rejects.toThrow();
    });

    it('rejects response to cancelled appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'cancelled',
        cancelledFromStatus: 'pending',
      });

      await expect(
        callFunction(
          'respondToRequest',
          { appointmentId: apptId, action: 'accept' },
          babysitterToken
        )
      ).rejects.toThrow();
    });
  });
});
