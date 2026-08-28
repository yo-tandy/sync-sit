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
        // Issue #238: the hard delete must erase the SITTER's authored note
        // immediately, while the family's own note stays theirs to manage.
        postAppointmentNote: 'sitter debrief',
        preAppointmentNote: 'family door code',
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
      // Issue #238: the deleted sitter's post-note is hard-erased with the
      // account; the family's pre-note survives (the family still exists and
      // manages its own note).
      expect('postAppointmentNote' in confirmedDoc.data()!).toBe(false);
      expect(confirmedDoc.data()!.preAppointmentNote).toBe('family door code');

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
        // Issue #238: when the LAST parent goes, the family's authored
        // pre-note goes with it (hard erasure, not the 7-day cron trail).
        preAppointmentNote: 'Door code 1234B',
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
      expect('preAppointmentNote' in apptDoc.data()!).toBe(false);

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
        // Issue #238: family-level data -- while a co-parent survives, the
        // note stays theirs to manage, so a NON-sole-parent delete must NOT
        // erase it (guards the isLastParent half of the deleteUser branch).
        preAppointmentNote: 'family door code',
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
      // Issue #238: the family's pre-note survives a co-parent delete.
      expect(redacted.data()!.preAppointmentNote).toBe('family door code');

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

  describe('references / endorsements (GDPR, issue #295)', () => {
    it('deleting a babysitter (PROVIDER) deletes their references — family-submitted and manual — leaving other sitters\' references untouched', async () => {
      const db = getDb();

      const familyRef = await db.collection('references').add({
        type: 'family_submitted',
        status: 'approved',
        babysitterUserId: seed.babysitter1.uid,
        submittedByUserId: seed.parent1.uid,
        submittedByFamilyId: seed.family1Id,
        submittedByName: 'Claire Dupont',
        refName: 'Claire Dupont',
        referenceText: 'Wonderful with our kids.',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      // Manual references carry third-party contact data the sitter entered.
      const manualRef = await db.collection('references').add({
        type: 'manual',
        status: 'published',
        babysitterUserId: seed.babysitter1.uid,
        refName: 'Ancien employeur',
        refPhone: '+33611111111',
        refEmail: 'ref@example.test',
        createdAt: new Date(),
      });
      const otherSitterRef = await db.collection('references').add({
        type: 'family_submitted',
        status: 'approved',
        babysitterUserId: seed.babysitter2.uid,
        submittedByUserId: seed.parent3.uid,
        submittedByFamilyId: seed.family2Id,
        submittedByName: 'Anna Martin',
        refName: 'Anna Martin',
        referenceText: 'Great sitter, always on time.',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await callFunction('deleteUser', { targetUserId: seed.babysitter1.uid }, adminToken);

      expect((await familyRef.get()).exists).toBe(false);
      expect((await manualRef.get()).exists).toBe(false);
      // Unrelated user's reference untouched.
      expect((await otherSitterRef.get()).exists).toBe(true);

      // The audit log records how many reference docs were erased (count only).
      const logs = await db
        .collection('auditLogs')
        .where('action', '==', 'delete_user')
        .where('targetUserId', '==', seed.babysitter1.uid)
        .get();
      expect(logs.docs).toHaveLength(1);
      // 3 = the two references seeded above + the manual reference
      // seedTestData pre-seeds for babysitter1 ("Claire Dubois").
      expect(logs.docs[0].data().details.deletedReferences).toBe(3);
    });

    it('deleting a tutor (PROVIDER) deletes the study endorsements about them', async () => {
      const db = getDb();

      const endorsement = await db.collection('references').add({
        type: 'family_submitted',
        appSource: 'study',
        status: 'approved',
        tutorUserId: seed.tutor1.uid,
        submittedByUserId: seed.parent1.uid,
        submittedByFamilyId: seed.family1Id,
        submittedByName: 'Claire Dupont',
        refName: 'Claire Dupont',
        referenceText: 'Patient tutor, our daughter improved fast.',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await callFunction('deleteUser', { targetUserId: seed.tutor1.uid }, adminToken);

      expect((await endorsement.get()).exists).toBe(false);
    });

    it('deleting a co-parent (SUBMITTER) deletes only the endorsements they personally submitted and decrements the tutor\'s endorsementCount', async () => {
      const db = getDb();

      // Two approved endorsements of tutor1 from family1: one by parent2 (the
      // user being deleted), one by parent1 (the surviving co-parent).
      const byDeletedParent = await db.collection('references').add({
        type: 'family_submitted',
        appSource: 'study',
        status: 'approved',
        tutorUserId: seed.tutor1.uid,
        submittedByUserId: seed.parent2.uid,
        submittedByFamilyId: seed.family1Id,
        submittedByName: 'Marc Dupont',
        refName: 'Marc Dupont',
        referenceText: 'Free-form family prose naming our kids.',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const bySurvivingParent = await db.collection('references').add({
        type: 'family_submitted',
        appSource: 'study',
        status: 'approved',
        tutorUserId: seed.tutor1.uid,
        submittedByUserId: seed.parent1.uid,
        submittedByFamilyId: seed.family1Id,
        submittedByName: 'Claire Dupont',
        refName: 'Claire Dupont',
        referenceText: 'Second endorsement from the other parent.',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.collection('users').doc(seed.tutor1.uid).update({
        'profiles.tutor.endorsementCount': 2,
      });

      await callFunction('deleteUser', { targetUserId: seed.parent2.uid }, adminToken);

      // The deleted submitter's endorsement is fully erased (the doc IS their
      // personal data: name + free-form text); the co-parent's own endorsement
      // survives — the family still exists and stands behind it.
      expect((await byDeletedParent.get()).exists).toBe(false);
      expect((await bySurvivingParent.get()).exists).toBe(true);

      // The surviving tutor's denormalized counter tracks the deletion.
      const tutorDoc = await db.collection('users').doc(seed.tutor1.uid).get();
      expect(tutorDoc.data()!.profiles.tutor.endorsementCount).toBe(1);
    });

    it('deleting the LAST parent deletes the family\'s endorsements via submittedByFamilyId (even when submitted by a departed parent)', async () => {
      const db = getDb();

      // Submitter uid no longer resolvable (e.g. a parent who left earlier and
      // was anonymized) — only the family key still ties the doc to family2.
      const familyKeyedRef = await db.collection('references').add({
        type: 'family_submitted',
        appSource: 'study',
        status: 'private',
        tutorUserId: seed.tutor1.uid,
        submittedByUserId: 'deleted',
        submittedByFamilyId: seed.family2Id,
        submittedByName: 'Ancien Parent',
        refName: 'Ancien Parent',
        referenceText: 'Endorsement from a family being fully erased.',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // parent3 is family2's sole parent.
      await callFunction('deleteUser', { targetUserId: seed.parent3.uid }, adminToken);

      expect((await familyKeyedRef.get()).exists).toBe(false);
      // Private (never-approved) endorsement: the tutor's counter was never
      // incremented, so the deletion must not create/decrement it.
      const tutorDoc = await db.collection('users').doc(seed.tutor1.uid).get();
      expect(tutorDoc.data()!.profiles.tutor.endorsementCount).toBeUndefined();
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
