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

  // ── Snapshot at create: the family-initiated path (issue #237) ──
  describe('notice-window snapshot', () => {
    it('sendContactRequest snapshots the sitter profile policy onto the appointment', async () => {
      const db = getDb();
      await db.collection('users').doc(seed.babysitter1.uid).update({
        'profiles.babysitter.cancellationNoticeHours': 48,
      });
      try {
        const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const res = await callFunction<{ appointmentId: string }>(
          'sendContactRequest',
          {
            babysitterUserId: seed.babysitter1.uid,
            searchType: 'one_time',
            date,
            startTime: '18:00',
            endTime: '21:00',
            kidIds: ['kid1'],
            address: '15 Rue de Passy, 75016 Paris',
            latLng: { lat: 48.8566, lng: 2.2769 },
            familyId: seed.family1Id,
          },
          parentToken,
        );
        const apt = (await db.collection('appointments').doc(res.appointmentId).get()).data()!;
        expect(apt.cancellationNoticeHours).toBe(48);
      } finally {
        await db.collection('users').doc(seed.babysitter1.uid).update({
          'profiles.babysitter.cancellationNoticeHours': 0,
        });
      }
    });

    it('clamps a grandfathered out-of-set profile value to the preset set at snapshot time', async () => {
      // The rules diff-gate grandfathers pre-rules values forever (PR #248
      // round 3 residual); the admin write below simulates such legacy data,
      // and the snapshot must round DOWN to the nearest preset (100 -> 48).
      const db = getDb();
      await db.collection('users').doc(seed.babysitter1.uid).update({
        'profiles.babysitter.cancellationNoticeHours': 100,
      });
      try {
        const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const res = await callFunction<{ appointmentId: string }>(
          'sendContactRequest',
          {
            babysitterUserId: seed.babysitter1.uid,
            searchType: 'one_time',
            date,
            startTime: '18:00',
            endTime: '21:00',
            kidIds: ['kid1'],
            address: '15 Rue de Passy, 75016 Paris',
            latLng: { lat: 48.8566, lng: 2.2769 },
            familyId: seed.family1Id,
          },
          parentToken,
        );
        const apt = (await db.collection('appointments').doc(res.appointmentId).get()).data()!;
        expect(apt.cancellationNoticeHours).toBe(48);
      } finally {
        await db.collection('users').doc(seed.babysitter1.uid).update({
          'profiles.babysitter.cancellationNoticeHours': 0,
        });
      }
    });
  });

  // ── Cancellation policy: allow-but-flag (issue #237, study's contract) ──
  describe('notice-window flag', () => {
    const soonDate = () => {
      const d = new Date(Date.now() + 24 * 60 * 60 * 1000); // ~24h out
      return d.toISOString().slice(0, 10);
    };
    const farDate = () => {
      const d = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      return d.toISOString().slice(0, 10);
    };

    it('flags a CONFIRMED one_time family cancel inside the snapshotted window', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
        date: soonDate(),
        startTime: '18:00',
        cancellationNoticeHours: 48,
      });
      await callFunction('cancelAppointment', { appointmentId: apptId, reason: 'Late change' }, parentToken);
      const apt = (await getDb().collection('appointments').doc(apptId).get()).data()!;
      expect(apt.status).toBe('cancelled');
      expect(apt.lateCancellation).toBe(true);
    });

    it('does NOT flag an on-time cancel, a pending cancel, or a no-policy cancel', async () => {
      for (const over of [
        { status: 'confirmed', date: farDate(), cancellationNoticeHours: 48 }, // on time
        { status: 'pending', date: soonDate(), cancellationNoticeHours: 48 }, // never for pendings
        { status: 'confirmed', date: soonDate(), cancellationNoticeHours: 0 }, // no policy
      ] as const) {
        const apptId = await seedAppointment({
          babysitterUserId: seed.babysitter1.uid,
          familyId: seed.family1Id,
          createdByUserId: seed.parent1.uid,
          startTime: '18:00',
          ...over,
        });
        await callFunction('cancelAppointment', { appointmentId: apptId, reason: 'Changed plans' }, parentToken);
        const apt = (await getDb().collection('appointments').doc(apptId).get()).data()!;
        expect(apt.lateCancellation).toBeUndefined();
      }
    });

    it('flags a BABYSITTER late cancel too -- the flag is a record, whoever cancels', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
        date: soonDate(),
        startTime: '18:00',
        cancellationNoticeHours: 48,
      });
      await callFunction('cancelAppointment', { appointmentId: apptId, reason: 'Sick today' }, babysitterToken);
      expect(
        (await getDb().collection('appointments').doc(apptId).get()).data()!.lateCancellation,
      ).toBe(true);
    });

    it('never flags a cancel of an appointment that already STARTED (cleanup, not lateness)', async () => {
      // Deviation from study (PR #248 round 2): study's completed-sweep cron
      // makes past sessions uncancellable; sit has no sweep, so stale
      // confirmed appointments stay cancellable as bookkeeping. Flagging
      // them would mint permanent "Cancelled late" badges for cleanup.
      const past = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // ~2 months ago
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
        date: past.toISOString().slice(0, 10),
        startTime: '18:00',
        cancellationNoticeHours: 48,
      });
      await callFunction('cancelAppointment', { appointmentId: apptId, reason: 'Old cleanup' }, parentToken);
      const apt = (await getDb().collection('appointments').doc(apptId).get()).data()!;
      expect(apt.status).toBe('cancelled');
      expect(apt.lateCancellation).toBeUndefined();
    });

    it('never flags a recurring cancel -- no single start to be late against (v1 deviation)', async () => {
      const apptId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
        type: 'recurring',
        cancellationNoticeHours: 48,
      });
      await callFunction('cancelAppointment', { appointmentId: apptId, reason: 'Term over, thanks' }, parentToken);
      expect(
        (await getDb().collection('appointments').doc(apptId).get()).data()!.lateCancellation,
      ).toBeUndefined();
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
