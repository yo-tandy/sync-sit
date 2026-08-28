import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb, parisDateFromNow } from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

describe('modifyAppointment', () => {
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
    it('family modifies time on pending appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'pending',
        startTime: '18:00',
        endTime: '22:00',
      });

      const result = await callFunction<{ success: boolean; modified: boolean; modifiedFields: string[] }>(
        'modifyAppointment',
        { appointmentId: apptId, startTime: '19:00' },
        parentToken
      );

      expect(result.success).toBe(true);
      expect(result.modified).toBe(true);
      expect(result.modifiedFields).toContain('startTime');

      const doc = await getDb().collection('appointments').doc(apptId).get();
      expect(doc.data()!.startTime).toBe('19:00');
      expect(doc.data()!.modified).toBe(true);
    });

    it('family modifies message on confirmed appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
        message: 'Original message',
      });

      await callFunction(
        'modifyAppointment',
        { appointmentId: apptId, message: 'Updated message' },
        parentToken
      );

      const doc = await getDb().collection('appointments').doc(apptId).get();
      expect(doc.data()!.message).toBe('Updated message');
      expect(doc.data()!.modified).toBe(true);
    });

    it('family modifies kidIds and kids array is re-denormalized', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'pending',
        kidIds: ['kid1'],
      });

      await callFunction(
        'modifyAppointment',
        { appointmentId: apptId, kidIds: ['kid1', 'kid2'] },
        parentToken
      );

      const doc = await getDb().collection('appointments').doc(apptId).get();
      expect(doc.data()!.kidIds).toEqual(['kid1', 'kid2']);
      expect(doc.data()!.kids).toHaveLength(2);
    });
  });

  describe('inside-window modify guard (issue #237, study contract ported)', () => {
    // "You cannot move what you could not cleanly cancel": even a same-day
    // startTime move can escape the flag (24h window, start 23h away, move
    // +14h -> clean cancel) -- the modify-then-cancel hole study closed in
    // PR #244 round 2.
    // Paris wall date ~tomorrow with a 09:00 start: inside a 48h window at
    // any hour, never already-started (see the flake-window note in
    // setup/emulator.ts).
    const soonDate = () => parisDateFromNow(1);
    const farDate = () => parisDateFromNow(14);

    it('blocks a startTime move on a confirmed appointment inside its window', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
        date: soonDate(),
        startTime: '09:00',
        endTime: '12:00',
        cancellationNoticeHours: 48,
      });
      try {
        await callFunction('modifyAppointment', { appointmentId: apptId, startTime: '22:00' }, parentToken);
        throw new Error('should have thrown');
      } catch (err) {
        expect((err as { message?: string }).message).toContain('inside_notice_window');
      }
      const apt = (await getDb().collection('appointments').doc(apptId).get()).data()!;
      expect(apt.startTime).toBe('09:00');
    });

    it('still allows message/additionalInfo edits inside the window', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
        date: soonDate(),
        startTime: '09:00',
        cancellationNoticeHours: 48,
      });
      await callFunction('modifyAppointment', { appointmentId: apptId, message: 'Door code is 4321' }, parentToken);
      const apt = (await getDb().collection('appointments').doc(apptId).get()).data()!;
      expect(apt.message).toBe('Door code is 4321');
    });

    it('allows a startTime move OUTSIDE the window, and with no policy', async () => {
      const outside = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
        date: farDate(),
        startTime: '09:00',
        cancellationNoticeHours: 48,
      });
      await callFunction('modifyAppointment', { appointmentId: outside, startTime: '10:00' }, parentToken);
      expect((await getDb().collection('appointments').doc(outside).get()).data()!.startTime).toBe('10:00');

      const noPolicy = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
        date: soonDate(),
        startTime: '09:00',
        cancellationNoticeHours: 0,
      });
      await callFunction('modifyAppointment', { appointmentId: noPolicy, startTime: '10:00' }, parentToken);
      expect((await getDb().collection('appointments').doc(noPolicy).get()).data()!.startTime).toBe('10:00');
    });

    it('does not guard a PENDING appointment inside the window (no claim to escape)', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'pending',
        date: soonDate(),
        startTime: '09:00',
        cancellationNoticeHours: 48,
      });
      await callFunction('modifyAppointment', { appointmentId: apptId, startTime: '10:00' }, parentToken);
      expect((await getDb().collection('appointments').doc(apptId).get()).data()!.startTime).toBe('10:00');
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated calls', async () => {
      await expect(
        callFunction('modifyAppointment', { appointmentId: 'x', startTime: '10:00' })
      ).rejects.toThrow();
    });

    it('rejects babysitter trying to modify', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
      });

      await expect(
        callFunction(
          'modifyAppointment',
          { appointmentId: apptId, startTime: '19:00' },
          babysitterToken
        )
      ).rejects.toThrow();
    });

    it('rejects parent from different family', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
      });

      const otherFamilyToken = await getIdToken(seed.parent3.uid);
      await expect(
        callFunction(
          'modifyAppointment',
          { appointmentId: apptId, startTime: '19:00' },
          otherFamilyToken
        )
      ).rejects.toThrow();
    });
  });

  describe('edge cases', () => {
    it('rejects modification of rejected appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'rejected',
        statusReason: 'declined_by_babysitter',
      });

      await expect(
        callFunction(
          'modifyAppointment',
          { appointmentId: apptId, startTime: '19:00' },
          parentToken
        )
      ).rejects.toThrow();
    });

    it('rejects modification of cancelled appointment', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'cancelled',
        cancelledFromStatus: 'pending',
      });

      await expect(
        callFunction(
          'modifyAppointment',
          { appointmentId: apptId, startTime: '19:00' },
          parentToken
        )
      ).rejects.toThrow();
    });

    it('no-op modification (same values) returns modified: false', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'pending',
        startTime: '18:00',
        endTime: '22:00',
      });

      const result = await callFunction<{ success: boolean; modified: boolean }>(
        'modifyAppointment',
        { appointmentId: apptId, startTime: '18:00', endTime: '22:00' },
        parentToken
      );

      expect(result.success).toBe(true);
      expect(result.modified).toBe(false);
    });
  });
});
