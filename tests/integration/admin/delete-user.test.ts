import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  clearAll,
  callFunction,
  getIdToken,
  getDb,
  getAdminAuth,
} from '../../setup/emulator.js';
import {
  seedTestData,
  seedAppointment,
  seedStudySession,
  seedStudyInstance,
  seedOverrideClaim,
  type SeedData,
} from '../../setup/seed.js';

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

  /**
   * Issue #408 item 1 — the GDPR erasure gaps the retention work (PR #396)
   * surfaced. Two halves, both pre-existing:
   *   • `schedules/{uid}` + `overrides` were deleted only for `role ===
   *     'babysitter'`, so a TUTOR-only account kept its whole availability
   *     grid and claim ledger through a hard delete;
   *   • `study-sessions` was never touched at all, on either side.
   */
  describe('study erasure (issue #408 item 1)', () => {
    const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    /** An all-available weekly grid, so a released claim restores to exactly it
     *  and the override doc is DELETED rather than rewritten — an unambiguous
     *  pin on "the slot came back". */
    async function seedOpenSchedule(uid: string): Promise<void> {
      const weekly: Record<string, boolean[]> = {};
      for (const key of DAY_KEYS) weekly[key] = new Array(96).fill(true);
      await getDb().collection('schedules').doc(uid).set({ userId: uid, weekly });
    }

    async function overrideExists(uid: string, date: string): Promise<boolean> {
      return (
        await getDb().collection('schedules').doc(uid).collection('overrides').doc(date).get()
      ).exists;
    }

    /** A 'YYYY-MM-DD' `n` days from now (negative = past). */
    function dateIn(n: number): string {
      return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    it('deleting a TUTOR deletes schedules/{uid} and its overrides', async () => {
      const db = getDb();
      // Seeded tutors already have a `schedules/{uid}` weekly grid.
      await db.collection('schedules').doc(seed.tutor1.uid).collection('overrides')
        .doc('2026-12-24').set({ date: '2026-12-24', type: 'unavailable', slots: [] });

      await callFunction('deleteUser', { targetUserId: seed.tutor1.uid }, adminToken);

      expect((await db.collection('schedules').doc(seed.tutor1.uid).get()).exists).toBe(false);
      expect(
        (await db.collection('schedules').doc(seed.tutor1.uid).collection('overrides').get())
          .empty,
      ).toBe(true);
      // A sibling tutor's schedule is untouched.
      expect((await db.collection('schedules').doc(seed.tutor2.uid).get()).exists).toBe(true);
    });

    it('deleting a tutor anonymizes their sessions, erases their post-notes and cancels the live ones', async () => {
      const db = getDb();
      const live = await seedStudySession({
        familyId: seed.family1Id,
        tutorUserId: seed.tutor1.uid,
        createdByUserId: seed.parent1.uid,
        parentUserId: seed.parent1.uid,
        status: 'confirmed',
        date: dateIn(14),
        preSessionNote: 'gate code 1234',
        postSessionNote: 'Lucas struggled with fractions',
      });
      const past = await seedStudySession({
        familyId: seed.family1Id,
        tutorUserId: seed.tutor1.uid,
        status: 'completed',
        date: dateIn(-90),
        postSessionNote: 'final debrief',
      });
      const other = await seedStudySession({
        familyId: seed.family1Id,
        tutorUserId: seed.tutor2.uid,
        status: 'confirmed',
        date: dateIn(14),
        postSessionNote: "another tutor's note",
      });

      await callFunction('deleteUser', { targetUserId: seed.tutor1.uid }, adminToken);

      const liveDoc = (await db.collection('study-sessions').doc(live).get()).data()!;
      expect(liveDoc.tutorUserId).toBe('deleted');
      expect(liveDoc.tutorName).toBe('');
      expect('postSessionNote' in liveDoc).toBe(false);
      expect(liveDoc.status).toBe('cancelled');
      expect(liveDoc.statusReason).toBe('account_deleted');
      expect(liveDoc.cancelledFromStatus).toBe('confirmed');
      // The FAMILY survives, so its side of the doc is untouched — including
      // the note it authored and the roster it owns.
      expect(liveDoc.familyName).toBe('Dupont');
      expect(liveDoc.parentName).toBe('Marie Dupont');
      expect(liveDoc.students).toEqual([{ firstName: 'Lucas', age: 6 }]);
      expect(liveDoc.address).toBe('15 Rue de Passy, 75016 Paris');
      expect(liveDoc.preSessionNote).toBe('gate code 1234');

      // A COMPLETED session is anonymized but never re-statused: it is the
      // family's record of a session that actually happened.
      const pastDoc = (await db.collection('study-sessions').doc(past).get()).data()!;
      expect(pastDoc.tutorUserId).toBe('deleted');
      expect(pastDoc.status).toBe('completed');
      expect('postSessionNote' in pastDoc).toBe(false);

      // Another tutor's session is untouched in every field.
      const otherDoc = (await db.collection('study-sessions').doc(other).get()).data()!;
      expect(otherDoc.tutorUserId).toBe(seed.tutor2.uid);
      expect(otherDoc.tutorName).toBe('Noa Katz');
      expect(otherDoc.status).toBe('confirmed');
      expect(otherDoc.postSessionNote).toBe("another tutor's note");
    });

    it('deleting the SOLE parent erases the family snapshots, cancels the session and returns the slot', async () => {
      const db = getDb();
      const date = dateIn(21);
      await seedOpenSchedule(seed.tutor2.uid);
      const sessionId = await seedStudySession({
        familyId: seed.family2Id, // family2 = Martin, parent3 is its sole parent
        tutorUserId: seed.tutor2.uid,
        createdByUserId: seed.parent3.uid,
        parentUserId: seed.parent3.uid,
        familyName: 'Martin',
        parentName: 'Sophie Martin',
        status: 'confirmed',
        date,
        message: 'Please ring twice',
        preSessionNote: 'allergic to peanuts',
        postSessionNote: 'went well',
      });
      await seedOverrideClaim(
        seed.tutor2.uid,
        date,
        { sessionId },
        { appSource: 'study', reason: 'study_session' },
      );

      await callFunction('deleteUser', { targetUserId: seed.parent3.uid }, adminToken);

      const doc = (await db.collection('study-sessions').doc(sessionId).get()).data()!;
      expect(doc.createdByUserId).toBe('deleted');
      expect(doc.parentUserId).toBe('deleted');
      expect(doc.familyName).toBe('');
      expect(doc.parentName).toBe('');
      expect(doc.students).toEqual([]);
      expect(doc.studentIds).toEqual([]);
      expect('address' in doc).toBe(false);
      expect('latLng' in doc).toBe(false);
      expect('message' in doc).toBe(false);
      expect('preSessionNote' in doc).toBe(false);
      expect(doc.status).toBe('cancelled');
      expect(doc.statusReason).toBe('account_deleted');
      // The TUTOR survives and is not the data subject: their identity and
      // their own free text stay exactly as they were.
      expect(doc.tutorUserId).toBe(seed.tutor2.uid);
      expect(doc.tutorName).toBe('Noa Katz');
      expect(doc.postSessionNote).toBe('went well');

      // The claim came back: the override held nothing else and the day
      // reverts to the bare weekly grid.
      expect(await overrideExists(seed.tutor2.uid, date)).toBe(false);
    });

    it('deleting a CO-PARENT anonymizes only their own uid and keeps the family session live', async () => {
      const db = getDb();
      const date = dateIn(10);
      await seedOpenSchedule(seed.tutor2.uid);
      const sessionId = await seedStudySession({
        familyId: seed.family1Id, // family1 = Dupont, TWO parents
        tutorUserId: seed.tutor2.uid,
        createdByUserId: seed.parent2.uid,
        parentUserId: seed.parent2.uid,
        parentName: 'Pierre Dupont',
        status: 'confirmed',
        date,
        preSessionNote: 'family door code',
      });
      await seedOverrideClaim(
        seed.tutor2.uid,
        date,
        { sessionId },
        { appSource: 'study', reason: 'study_session' },
      );

      await callFunction('deleteUser', { targetUserId: seed.parent2.uid }, adminToken);

      const doc = (await db.collection('study-sessions').doc(sessionId).get()).data()!;
      expect(doc.createdByUserId).toBe('deleted');
      expect(doc.parentUserId).toBe('deleted');
      // The family still exists and can honour the booking: nothing
      // family-level is erased and the session stays confirmed.
      expect(doc.familyName).toBe('Dupont');
      expect(doc.parentName).toBe('Pierre Dupont');
      expect(doc.students).toEqual([{ firstName: 'Lucas', age: 6 }]);
      expect(doc.address).toBe('15 Rue de Passy, 75016 Paris');
      expect(doc.preSessionNote).toBe('family door code');
      expect(doc.status).toBe('confirmed');
      // ...and the tutor keeps the slot they are still booked for.
      expect(await overrideExists(seed.tutor2.uid, date)).toBe(true);
    });

    it('a recurring series: FUTURE occurrences are cancelled with their claims, past ones keep their status', async () => {
      const db = getDb();
      const pastDate = dateIn(-7);
      const futureDate = dateIn(7);
      await seedOpenSchedule(seed.tutor2.uid);
      const sessionId = await seedStudySession({
        familyId: seed.family2Id,
        tutorUserId: seed.tutor2.uid,
        createdByUserId: seed.parent3.uid,
        parentUserId: seed.parent3.uid,
        familyName: 'Martin',
        parentName: 'Sophie Martin',
        status: 'confirmed',
        type: 'recurring',
        date: undefined,
        endTime: undefined,
        recurringSlots: [{ day: 'mon', startTime: '17:00', endTime: '18:00' }],
      });
      await seedStudyInstance(sessionId, pastDate, {
        preSessionNote: 'old door code',
        postSessionNote: 'past debrief',
      });
      await seedStudyInstance(sessionId, futureDate, {
        preSessionNote: 'new door code',
      });
      await seedOverrideClaim(
        seed.tutor2.uid,
        pastDate,
        { sessionId, instanceId: pastDate },
        { appSource: 'study', reason: 'study_session' },
      );
      await seedOverrideClaim(
        seed.tutor2.uid,
        futureDate,
        { sessionId, instanceId: futureDate },
        { appSource: 'study', reason: 'study_session' },
      );

      await callFunction('deleteUser', { targetUserId: seed.parent3.uid }, adminToken);

      const instances = db.collection('study-sessions').doc(sessionId).collection('instances');
      const pastInst = (await instances.doc(pastDate).get()).data()!;
      const futureInst = (await instances.doc(futureDate).get()).data()!;

      // The past occurrence HAPPENED — cancelling it would rewrite the
      // surviving tutor's history (cancelSession's own rule).
      expect(pastInst.status).toBe('scheduled');
      // ...but the family's free text on it still goes.
      expect('preSessionNote' in pastInst).toBe(false);
      // The tutor's own note on it survives: they are not the data subject.
      expect(pastInst.postSessionNote).toBe('past debrief');

      expect(futureInst.status).toBe('cancelled');
      expect(futureInst.statusReason).toBe('cancelled_by_family');
      expect('preSessionNote' in futureInst).toBe(false);

      // Only the FUTURE date's claim is released.
      expect(await overrideExists(seed.tutor2.uid, futureDate)).toBe(false);
      expect(await overrideExists(seed.tutor2.uid, pastDate)).toBe(true);
    });

    it('sole-parent erasure gives the surviving BABYSITTER back the appointment slot', async () => {
      const db = getDb();
      const date = dateIn(9);
      await seedOpenSchedule(seed.babysitter1.uid);
      const appointmentId = await seedAppointment({
        babysitterUserId: seed.babysitter1.uid,
        familyId: seed.family2Id,
        createdByUserId: seed.parent3.uid,
        status: 'confirmed',
        date,
      });
      await seedOverrideClaim(
        seed.babysitter1.uid,
        date,
        { appointmentId },
        { appSource: 'sit', reason: 'appointment' },
      );

      await callFunction('deleteUser', { targetUserId: seed.parent3.uid }, adminToken);

      expect((await db.collection('appointments').doc(appointmentId).get()).data()!.status)
        .toBe('cancelled');
      // Before #408 the appointment was cancelled and the claim was left
      // behind: the sitter's slot stayed blocked forever.
      expect(await overrideExists(seed.babysitter1.uid, date)).toBe(false);
    });

    it('records the study counts in the audit log', async () => {
      const db = getDb();
      await seedStudySession({
        familyId: seed.family1Id,
        tutorUserId: seed.tutor1.uid,
        status: 'confirmed',
        date: dateIn(5),
      });

      await callFunction('deleteUser', { targetUserId: seed.tutor1.uid }, adminToken);

      const logs = await db.collection('auditLogs')
        .where('action', '==', 'delete_user')
        .where('targetUserId', '==', seed.tutor1.uid)
        .get();
      expect(logs.size).toBe(1);
      const details = logs.docs[0].data().details;
      expect(details.anonymizedStudySessions).toBe(1);
      expect(details.cancelledStudySessions).toBe(1);
      expect(details.erasureFailures).toBe(0);
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
