import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  clearAll,
  callFunction,
  getIdToken,
  getDb,
  getAdminAuth,
} from '../../setup/emulator.js';
import { seedTestData, seedAppointment, type SeedData } from '../../setup/seed.js';

/**
 * deleteUser is destructive and asymmetric (different cascades for
 * babysitter vs sole-parent vs co-parent). Every test re-seeds because
 * a single delete makes the entire seed inconsistent.
 */
describe('deleteUser', () => {
  let seed: SeedData;
  let adminToken: string;

  beforeEach(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  describe('happy paths', () => {
    it('deleting a babysitter: anonymizes appointments, deletes schedule + notifications + auth user', async () => {
      const db = getDb();

      const apptPending = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'pending',
      });
      const apptConfirmed = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'confirmed',
      });
      const apptOldRejected = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'rejected',
      });

      await db.collection('schedules').doc(seed.babysitter1.uid).collection('overrides')
        .doc('override-1').set({ date: '2026-12-25', slots: [] });

      await db.collection('notifications').add({
        recipientUserId: seed.babysitter1.uid,
        type: 'new_request',
        createdAt: new Date(),
      });

      const result = await callFunction<{ success: boolean; cancelledAppointments: number }>(
        'deleteUser',
        { targetUserId: seed.babysitter1.uid },
        adminToken,
      );

      expect(result.success).toBe(true);
      expect(result.cancelledAppointments).toBe(2);

      // Anonymized + status updated
      const pendingDoc = await db.collection('appointments').doc(apptPending).get();
      expect(pendingDoc.data()!.babysitterUserId).toBe('deleted');
      expect(pendingDoc.data()!.status).toBe('cancelled');
      expect(pendingDoc.data()!.statusReason).toBe('account_deleted');

      const confirmedDoc = await db.collection('appointments').doc(apptConfirmed).get();
      expect(confirmedDoc.data()!.status).toBe('cancelled');

      // Rejected appointments only get anonymized, not re-statused
      const rejectedDoc = await db.collection('appointments').doc(apptOldRejected).get();
      expect(rejectedDoc.data()!.babysitterUserId).toBe('deleted');
      expect(rejectedDoc.data()!.status).toBe('rejected');

      // Schedule + overrides deleted
      const scheduleDoc = await db.collection('schedules').doc(seed.babysitter1.uid).get();
      expect(scheduleDoc.exists).toBe(false);
      const overrides = await db.collection('schedules').doc(seed.babysitter1.uid)
        .collection('overrides').get();
      expect(overrides.empty).toBe(true);

      // Notifications gone
      const notifications = await db.collection('notifications')
        .where('recipientUserId', '==', seed.babysitter1.uid).get();
      expect(notifications.empty).toBe(true);

      // User doc gone
      const userDoc = await db.collection('users').doc(seed.babysitter1.uid).get();
      expect(userDoc.exists).toBe(false);

      // Auth account gone
      await expect(getAdminAuth().getUser(seed.babysitter1.uid)).rejects.toMatchObject({
        code: 'auth/user-not-found',
      });
    });

    it('deleting the sole parent of a family: deletes family doc + kids + cancels family appointments', async () => {
      const db = getDb();

      const apptPending = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family2Id,
        createdByUserId: seed.parent3.uid,
        status: 'pending',
      });

      const result = await callFunction<{ success: boolean; cancelledAppointments: number }>(
        'deleteUser',
        { targetUserId: seed.parent3.uid },
        adminToken,
      );

      expect(result.success).toBe(true);

      // Family deleted
      const familyDoc = await db.collection('families').doc(seed.family2Id).get();
      expect(familyDoc.exists).toBe(false);
      const kids = await db.collection('families').doc(seed.family2Id).collection('kids').get();
      expect(kids.empty).toBe(true);

      // Family appointment cancelled (note: babysitterUserId is also anonymized
      // because this appt matches BOTH babysitter and family filters)
      const apptDoc = await db.collection('appointments').doc(apptPending).get();
      expect(apptDoc.data()!.status).toBe('cancelled');

      // User + auth gone
      expect((await db.collection('users').doc(seed.parent3.uid).get()).exists).toBe(false);
      await expect(getAdminAuth().getUser(seed.parent3.uid)).rejects.toMatchObject({
        code: 'auth/user-not-found',
      });
    });

    it('deleting one of two parents: family + co-parent preserved, parentIds trimmed', async () => {
      const db = getDb();

      const result = await callFunction<{ success: boolean }>(
        'deleteUser',
        { targetUserId: seed.parent2.uid },
        adminToken,
      );

      expect(result.success).toBe(true);

      // Family intact, parent2 removed from parentIds
      const familyDoc = await db.collection('families').doc(seed.family1Id).get();
      expect(familyDoc.exists).toBe(true);
      expect(familyDoc.data()!.parentIds).toEqual([seed.parent1.uid]);

      // Co-parent intact
      const coParentDoc = await db.collection('users').doc(seed.parent1.uid).get();
      expect(coParentDoc.exists).toBe(true);

      // Kids intact
      const kids = await db.collection('families').doc(seed.family1Id).collection('kids').get();
      expect(kids.empty).toBe(false);

      // Deleted parent gone
      expect((await db.collection('users').doc(seed.parent2.uid).get()).exists).toBe(false);
    });

    it('deleting one of two parents: anonymizes createdByUserId on appointments they created (no cancellation)', async () => {
      // GDPR regression: when a non-sole parent is deleted, family appointments
      // they created must have createdByUserId redacted. Active appointments
      // must NOT be cancelled — the family still exists and owns them.
      const db = getDb();

      const apptByDeletedParent = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent2.uid, // the parent being deleted
        status: 'confirmed',
      });
      const apptByRemainingParent = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid, // the parent staying
        status: 'pending',
      });

      await callFunction('deleteUser', { targetUserId: seed.parent2.uid }, adminToken);

      const redacted = await db.collection('appointments').doc(apptByDeletedParent).get();
      expect(redacted.data()!.createdByUserId).toBe('deleted');
      // Still active — co-parent path must not cancel
      expect(redacted.data()!.status).toBe('confirmed');
      expect(redacted.data()!.statusReason).toBeUndefined();

      // Untouched appointment created by the remaining parent
      const untouched = await db.collection('appointments').doc(apptByRemainingParent).get();
      expect(untouched.data()!.createdByUserId).toBe(seed.parent1.uid);
      expect(untouched.data()!.status).toBe('pending');
    });

    it('writes an audit log entry capturing role and cancelled count', async () => {
      await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family1Id,
        createdByUserId: seed.parent1.uid,
        status: 'pending',
      });

      await callFunction(
        'deleteUser',
        { targetUserId: seed.babysitter1.uid },
        adminToken,
      );

      const logs = await getDb()
        .collection('auditLogs')
        .where('action', '==', 'delete_user')
        .where('targetUserId', '==', seed.babysitter1.uid)
        .get();

      expect(logs.docs).toHaveLength(1);
      expect(logs.docs[0].data().details.role).toBe('babysitter');
      expect(logs.docs[0].data().details.cancelledAppointments).toBe(1);
    });
  });

  describe('errors', () => {
    it('rejects unauthenticated callers', async () => {
      await expect(
        callFunction('deleteUser', { targetUserId: seed.babysitter1.uid }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('rejects non-admin (parent) callers', async () => {
      const parentToken = await getIdToken(seed.parent1.uid);
      await expect(
        callFunction(
          'deleteUser',
          { targetUserId: seed.babysitter1.uid },
          parentToken,
        ),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('rejects missing targetUserId', async () => {
      await expect(
        callFunction('deleteUser', {}, adminToken),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('returns not-found for non-existent user', async () => {
      await expect(
        callFunction('deleteUser', { targetUserId: 'no-such-user' }, adminToken),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
