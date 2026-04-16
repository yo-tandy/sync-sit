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
