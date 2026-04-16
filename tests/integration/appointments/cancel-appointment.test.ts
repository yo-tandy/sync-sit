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
