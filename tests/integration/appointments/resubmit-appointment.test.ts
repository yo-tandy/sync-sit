import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

describe('resubmitAppointment', () => {
  let seed: SeedData;
  let parentToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parentToken = await getIdToken(seed.parent1.uid);
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
    it('creates new pending appointment from rejected one', async () => {
      const originalId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'rejected',
        statusReason: 'declined_by_babysitter',
        startTime: '18:00',
        endTime: '22:00',
      });

      const result = await callFunction<{ success: boolean; appointmentId: string }>(
        'resubmitAppointment',
        {
          originalAppointmentId: originalId,
          startTime: '19:00',
          endTime: '23:00',
          additionalNotes: 'Can you reconsider with this new time?',
        },
        parentToken
      );

      expect(result.success).toBe(true);
      expect(result.appointmentId).toBeTruthy();
      expect(result.appointmentId).not.toBe(originalId);

      const newDoc = await getDb().collection('appointments').doc(result.appointmentId).get();
      expect(newDoc.data()!.status).toBe('pending');
      expect(newDoc.data()!.isResubmission).toBe(true);
      expect(newDoc.data()!.resubmittedFromAppointmentId).toBe(originalId);
      expect(newDoc.data()!.startTime).toBe('19:00');

      const originalDoc = await getDb().collection('appointments').doc(originalId).get();
      expect(originalDoc.data()!.resubmitted).toBe(true);
    });

    it('resubmit with kidIds change denormalizes new kids', async () => {
      const originalId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'rejected',
        statusReason: 'declined_by_babysitter',
        kidIds: ['kid1'],
      });

      const result = await callFunction<{ success: boolean; appointmentId: string }>(
        'resubmitAppointment',
        {
          originalAppointmentId: originalId,
          kidIds: ['kid1', 'kid2'],
          additionalNotes: 'Also bringing Emma this time',
        },
        parentToken
      );

      const newDoc = await getDb().collection('appointments').doc(result.appointmentId).get();
      expect(newDoc.data()!.kidIds).toEqual(['kid1', 'kid2']);
      expect(newDoc.data()!.kids).toHaveLength(2);
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated calls', async () => {
      await expect(
        callFunction('resubmitAppointment', {
          originalAppointmentId: 'x',
          additionalNotes: 'test',
        })
      ).rejects.toThrow();
    });

    it('rejects empty additionalNotes', async () => {
      const originalId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'rejected',
        statusReason: 'declined_by_babysitter',
      });

      await expect(
        callFunction(
          'resubmitAppointment',
          { originalAppointmentId: originalId, additionalNotes: '   ' },
          parentToken
        )
      ).rejects.toThrow();
    });

    it('rejects resubmit of non-rejected appointment', async () => {
      const originalId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'pending',
      });

      await expect(
        callFunction(
          'resubmitAppointment',
          { originalAppointmentId: originalId, additionalNotes: 'test' },
          parentToken
        )
      ).rejects.toThrow();
    });

    it('rejects resubmit by parent from different family', async () => {
      const originalId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'rejected',
        statusReason: 'declined_by_babysitter',
      });

      const otherFamilyToken = await getIdToken(seed.parent3.uid);
      await expect(
        callFunction(
          'resubmitAppointment',
          { originalAppointmentId: originalId, additionalNotes: 'test' },
          otherFamilyToken
        )
      ).rejects.toThrow();
    });
  });
});
