import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

describe('cancelAppointment', () => {
  let seed: SeedData;
  let parentToken: string;
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parentToken = await getIdToken(seed.parent1.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    const appts = await db.collection('appointments').get();
    await Promise.all(appts.docs.map((d) => d.ref.delete()));
  });

  describe('happy paths', () => {
    it('family cancels pending appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'pending',
      });

      const result = await callFunction<{ success: boolean }>(
        'cancelAppointment',
        { appointmentId: apptId, reason: 'Plans changed' },
        parentToken
      );

      expect(result.success).toBe(true);

      const doc = await getDb().collection('appointments').doc(apptId).get();
      expect(doc.data()!.status).toBe('cancelled');
      expect(doc.data()!.statusReason).toBe('cancelled_by_family');
      expect(doc.data()!.cancelledFromStatus).toBe('pending');
      expect(doc.data()!.cancellationReason).toBe('Plans changed');
    });

    it('family cancels confirmed appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
      });

      await callFunction(
        'cancelAppointment',
        { appointmentId: apptId, reason: 'Kid is sick' },
        parentToken
      );

      const doc = await getDb().collection('appointments').doc(apptId).get();
      expect(doc.data()!.status).toBe('cancelled');
      expect(doc.data()!.cancelledFromStatus).toBe('confirmed');
    });

    it('babysitter cancels confirmed appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
      });

      await callFunction(
        'cancelAppointment',
        { appointmentId: apptId, reason: 'Emergency' },
        babysitterToken
      );

      const doc = await getDb().collection('appointments').doc(apptId).get();
      expect(doc.data()!.status).toBe('cancelled');
      expect(doc.data()!.statusReason).toBe('cancelled_by_babysitter');
    });

    it('babysitter cancels pending appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'pending',
      });

      await callFunction(
        'cancelAppointment',
        { appointmentId: apptId, reason: 'Cannot make it' },
        babysitterToken
      );

      const doc = await getDb().collection('appointments').doc(apptId).get();
      expect(doc.data()!.status).toBe('cancelled');
      expect(doc.data()!.statusReason).toBe('cancelled_by_babysitter');
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated calls', async () => {
      await expect(
        callFunction('cancelAppointment', { appointmentId: 'x', reason: 'test' })
      ).rejects.toThrow();
    });

    it('rejects empty reason', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
      });

      await expect(
        callFunction(
          'cancelAppointment',
          { appointmentId: apptId, reason: '   ' },
          parentToken
        )
      ).rejects.toThrow();
    });

    it('rejects missing appointmentId', async () => {
      await expect(
        callFunction('cancelAppointment', { reason: 'test' }, parentToken)
      ).rejects.toThrow();
    });

    it('rejects outsider (not family, not babysitter)', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
      });

      // parent3 is in family2, unrelated to this appointment
      const outsiderToken = await getIdToken(seed.parent3.uid);
      await expect(
        callFunction(
          'cancelAppointment',
          { appointmentId: apptId, reason: 'test' },
          outsiderToken
        )
      ).rejects.toThrow();
    });

    it('rejects non-existent appointment', async () => {
      await expect(
        callFunction(
          'cancelAppointment',
          { appointmentId: 'nope', reason: 'test' },
          parentToken
        )
      ).rejects.toThrow();
    });
  });

  // ── H3: cancelling a confirmed appointment restores its claimed slots ──
  // Far-future Monday; babysitter1's Monday grid is 17:00–22:00 (slots 68..87).
  describe('schedule ledger restoration', () => {
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

    it('restores the claimed slots and DELETES the clean override on cancel', async () => {
      // Claim end-to-end: accept with blockSchedule writes the ledger'd override.
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'pending',
        date: MON, startTime: '18:00', endTime: '20:00',
      });
      await callFunction(
        'respondToRequest',
        { appointmentId: apptId, action: 'accept', blockSchedule: true },
        babysitterToken
      );
      const claimed = (await overrideRef().get()).data()!;
      expect(claimed.slots[72]).toBe(false);
      expect(claimed.sessionBlocks).toEqual([
        { appointmentId: apptId, startIdx: 72, endIdx: 80 },
      ]);

      // Cancel → the day was purely this claim → override deleted (day reverts
      // to the bare weekly grid; the slots are finally FREED).
      await callFunction(
        'cancelAppointment',
        { appointmentId: apptId, reason: 'Plans changed' },
        babysitterToken
      );
      expect((await overrideRef().get()).exists).toBe(false);
    });

    it('leaves a LEGACY ledgerless override untouched on cancel (conservative)', async () => {
      // A pre-H3 override: whole-day unavailable, no appSource, no sessionBlocks.
      await overrideRef().set({
        date: MON, type: 'unavailable', reason: 'appointment',
        appointmentId: 'legacy-apt', createdAt: new Date(),
      });
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
        date: MON, startTime: '18:00', endTime: '20:00',
      });

      await callFunction(
        'cancelAppointment',
        { appointmentId: apptId, reason: 'Emergency' },
        babysitterToken
      );

      // No matching ledger entry → the legacy doc is byte-untouched.
      const doc = (await overrideRef().get()).data()!;
      expect(doc.type).toBe('unavailable');
      expect(doc.sessionBlocks).toBeUndefined();
      expect(doc.appSource).toBeUndefined();
      expect(doc.appointmentId).toBe('legacy-apt');
    });
  });

  describe('edge cases', () => {
    it('rejects cancel on already-cancelled appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'cancelled',
        cancelledFromStatus: 'pending',
      });

      await expect(
        callFunction(
          'cancelAppointment',
          { appointmentId: apptId, reason: 'test' },
          parentToken
        )
      ).rejects.toThrow();
    });

    it('rejects cancel on already-rejected appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'rejected',
        statusReason: 'declined_by_babysitter',
      });

      await expect(
        callFunction(
          'cancelAppointment',
          { appointmentId: apptId, reason: 'test' },
          parentToken
        )
      ).rejects.toThrow();
    });
  });
});
