import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  clearAll,
  callFunction,
  getIdToken,
  getDb,
  getBucket,
  clearStoragePrefix,
  parisDateFromNow,
} from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// PR10's GDPR half (plan §11.4, §14). `doTasks` + `taskOffers` join
// exportUserData and the hard-delete path on BOTH sides — a family's tasks
// and a doer's offers — and the delete additionally removes the caller's
// whole `do-photos/{uid}/**` and `do-uploads/{uid}/**` prefixes and scrubs
// that uid's `{uid, photoId}` entries out of the family's SURVIVING tasks.
//
// `beforeEach` re-seeds because deleteUser is destructive and asymmetric,
// the same reason delete-user.test.ts gives.

const DAY_MS = 24 * 60 * 60 * 1000;

interface ExportResponse {
  doTasks: { id: string; title: string; familyId: string }[];
  taskOffers: { id: string; doerUserId: string; helper: unknown }[];
  doPhotoPaths: string[];
}

async function seedTask(
  taskId: string,
  familyId: string,
  createdByUserId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date();
  await getDb()
    .collection('doTasks')
    .doc(taskId)
    .set({
      taskId,
      familyId,
      createdByUserId,
      familyName: 'Dupont',
      areaLabel: '16e',
      category: 'ikea',
      subCategory: 'ikea_assembly',
      title: `Task ${taskId}`,
      description: 'Flat-pack, tools provided.',
      photos: [],
      timing: 'deadline',
      date: null,
      startTime: null,
      endTime: null,
      dueDate: parisDateFromNow(10),
      startDate: null,
      endDate: null,
      cadence: null,
      estimatedHours: null,
      suggestedBudget: null,
      adultPresent: 'yes',
      toolsProvided: true,
      transportNeeded: false,
      status: 'open',
      offerCount: 0,
      assignedUserId: null,
      assignedOfferId: null,
      assignedAt: null,
      agreedPrice: null,
      doerMarkedDoneAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 10 * DAY_MS),
      ...overrides,
    });
}

async function seedOffer(
  taskId: string,
  doerUserId: string,
  familyId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const offerId = `${taskId}_${doerUserId}`;
  const now = new Date();
  await getDb()
    .collection('taskOffers')
    .doc(offerId)
    .set({
      offerId,
      taskId,
      doerUserId,
      familyId,
      doerFirstName: 'Dora',
      doerPhotoUrl: null,
      doerBio: 'Handy with a hex key.',
      taskTitle: `Task ${taskId}`,
      taskCategory: 'ikea',
      taskTiming: 'deadline',
      price: 40,
      priceBasis: 'flat',
      message: 'I can do this on Saturday.',
      helper: null,
      availabilityNote: null,
      status: 'pending',
      declinedReason: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  return offerId;
}

async function seedPhoto(uid: string, photoId: string, prefix = 'do-photos') {
  await getBucket()
    .file(`${prefix}/${uid}/${photoId}`)
    .save(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]), {
      resumable: false,
      metadata: { contentType: 'image/jpeg' },
    });
}

async function objectExists(path: string): Promise<boolean> {
  const [exists] = await getBucket().file(path).exists();
  return exists;
}

describe('GDPR coverage for sync-do data (§11.4)', () => {
  let seed: SeedData;
  let adminToken: string;

  beforeEach(async () => {
    await clearAll();
    await clearStoragePrefix('do-photos/');
    await clearStoragePrefix('do-uploads/');
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
  });

  afterAll(async () => {
    await clearStoragePrefix('do-photos/');
    await clearStoragePrefix('do-uploads/');
    await clearAll();
  });

  describe('exportUserData', () => {
    it("includes a family's tasks and the photo paths they reference", async () => {
      await seedTask('gdpr-task-1', seed.family1Id, seed.parent1.uid, {
        photos: [
          { uid: seed.parent1.uid, photoId: 'ph-1' },
          { uid: seed.parent2.uid, photoId: 'ph-2' },
        ],
      });
      // The co-parent's task: family data, so it must reach parent1's export
      // the same way family appointments and family endorsements do.
      await seedTask('gdpr-task-2', seed.family1Id, seed.parent2.uid);
      // Another family's task must NOT appear.
      await seedTask('gdpr-task-other', seed.family2Id, seed.parent3.uid);

      const res = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.parent1.uid },
        adminToken,
      );

      expect(res.doTasks.map((t) => t.id).sort()).toEqual(['gdpr-task-1', 'gdpr-task-2']);
      // §11.4: "the export enumerates the photo paths referenced from the
      // user's tasks" — both parents' pairs, because both sit on a family
      // task the subject can see.
      expect(res.doPhotoPaths.sort()).toEqual(
        [
          `do-photos/${seed.parent1.uid}/ph-1`,
          `do-photos/${seed.parent2.uid}/ph-2`,
        ].sort(),
      );
    });

    it("includes a doer's offers, with the +1 helper the offer names", async () => {
      await seedTask('gdpr-task-1', seed.family1Id, seed.parent1.uid);
      await seedOffer('gdpr-task-1', seed.babysitter1.uid, seed.family1Id, {
        helper: { firstName: 'Leo', lastName: 'Martin', age: 14 },
      });
      // A different doer's offer on the same task must not leak into the
      // first doer's export.
      await seedOffer('gdpr-task-1', seed.babysitter2.uid, seed.family1Id);

      const res = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.babysitter1.uid },
        adminToken,
      );

      expect(res.taskOffers.map((o) => o.doerUserId)).toEqual([seed.babysitter1.uid]);
      // The §11.3 helper has no account of their own, so the doer's export
      // is the only route their data reaches a subject-access request.
      expect(res.taskOffers[0].helper).toEqual({
        firstName: 'Leo',
        lastName: 'Martin',
        age: 14,
      });
      // A doer holds no family, so no tasks and no photo paths.
      expect(res.doTasks).toEqual([]);
      expect(res.doPhotoPaths).toEqual([]);
    });

    // The round-1 blocker. A family's export must not hand them offers
    // `firestore.rules` deliberately withholds: the allow-list is
    // ['pending','accepted','declined'], and §6.2's invisibility promise
    // depends on it — a guardian DENIAL moves an offer to `withdrawn`, and
    // §6.4's sibling flip routes guardian-gated offers to `expired` rather
    // than `declined` so a family cannot flush them into view by accepting
    // someone. A data subject's export carries THEIR personal data, never
    // third-party data the platform deliberately kept from them.
    it("excludes offer statuses the family may not read, and the helper they name", async () => {
      await seedTask('gdpr-task-1', seed.family1Id, seed.parent1.uid);
      await seedOffer('gdpr-task-1', seed.babysitter1.uid, seed.family1Id, {
        status: 'pending',
      });
      await seedOffer('gdpr-task-1', seed.babysitter2.uid, seed.family1Id, {
        status: 'accepted',
      });
      await seedOffer('gdpr-task-1', seed.babysitter3.uid, seed.family1Id, {
        status: 'declined',
        declinedReason: 'family_declined',
      });
      // Guardian-denied: `withdrawn`, and it names a minor helper.
      await seedOffer('gdpr-task-1', seed.tutor1.uid, seed.family1Id, {
        status: 'withdrawn',
        doerFirstName: 'Gwen',
        message: 'SECRET-WITHDRAWN-MESSAGE',
        helper: { firstName: 'Hidden', lastName: 'Helper', age: 13 },
      });
      // Awaiting a guardian decision: never family-readable.
      await seedOffer('gdpr-task-1', seed.tutor2.uid, seed.family1Id, {
        status: 'pending_guardian',
        doerFirstName: 'Gus',
        message: 'SECRET-GUARDIAN-MESSAGE',
        helper: { firstName: 'Secret', lastName: 'Sidekick', age: 14 },
      });

      const res = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.parent1.uid },
        adminToken,
      );

      expect(res.taskOffers.map((o) => o.doerUserId).sort()).toEqual(
        [seed.babysitter1.uid, seed.babysitter2.uid, seed.babysitter3.uid].sort(),
      );
      // Neither the withheld offers' text nor the minor helpers they name
      // may appear anywhere in the payload.
      const blob = JSON.stringify(res);
      expect(blob).not.toContain('SECRET-WITHDRAWN-MESSAGE');
      expect(blob).not.toContain('SECRET-GUARDIAN-MESSAGE');
      expect(blob).not.toContain('Hidden');
      expect(blob).not.toContain('Sidekick');
    });

    // The other side of the same rule: those offers ARE the doer's own
    // personal data, so the doer-side query must stay unrestricted.
    it('still exports a withdrawn offer to the DOER who made it', async () => {
      await seedTask('gdpr-task-1', seed.family1Id, seed.parent1.uid);
      await seedOffer('gdpr-task-1', seed.tutor1.uid, seed.family1Id, {
        status: 'withdrawn',
        message: 'SECRET-WITHDRAWN-MESSAGE',
      });

      const res = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.tutor1.uid },
        adminToken,
      );
      expect(res.taskOffers.map((o) => o.doerUserId)).toEqual([seed.tutor1.uid]);
      expect(JSON.stringify(res)).toContain('SECRET-WITHDRAWN-MESSAGE');
    });

    it('leaves an unrelated user with no sync-do data at all', async () => {
      await seedTask('gdpr-task-1', seed.family1Id, seed.parent1.uid, {
        photos: [{ uid: seed.parent1.uid, photoId: 'ph-1' }],
      });
      await seedOffer('gdpr-task-1', seed.babysitter1.uid, seed.family1Id);

      const res = await callFunction<ExportResponse>(
        'exportUserData',
        { targetUserId: seed.babysitter3.uid },
        adminToken,
      );
      expect(res.doTasks).toEqual([]);
      expect(res.taskOffers).toEqual([]);
      expect(res.doPhotoPaths).toEqual([]);
    });
  });

  describe('deleteUser — documents', () => {
    it("deletes a doer's offers wherever they live, and nobody else's", async () => {
      await seedTask('gdpr-task-1', seed.family1Id, seed.parent1.uid);
      await seedOffer('gdpr-task-1', seed.babysitter1.uid, seed.family1Id);
      const survivorId = await seedOffer(
        'gdpr-task-1',
        seed.babysitter2.uid,
        seed.family1Id,
      );

      await callFunction('deleteUser', { targetUserId: seed.babysitter1.uid }, adminToken);

      const db = getDb();
      expect(
        (await db.collection('taskOffers').doc(`gdpr-task-1_${seed.babysitter1.uid}`).get()).exists,
      ).toBe(false);
      expect((await db.collection('taskOffers').doc(survivorId).get()).exists).toBe(true);
      // The family's task itself is untouched — the doer is the data
      // subject, not the family.
      expect((await db.collection('doTasks').doc('gdpr-task-1').get()).exists).toBe(true);
    });

    it("deletes a deleted parent's own tasks, with their offers, while a co-parent survives", async () => {
      await seedTask('gdpr-task-mine', seed.family1Id, seed.parent1.uid);
      await seedTask('gdpr-task-coparent', seed.family1Id, seed.parent2.uid);
      await seedOffer('gdpr-task-mine', seed.babysitter1.uid, seed.family1Id);

      await callFunction('deleteUser', { targetUserId: seed.parent1.uid }, adminToken);

      const db = getDb();
      // parent1 authored it: their free text and photos, so it goes.
      expect((await db.collection('doTasks').doc('gdpr-task-mine').get()).exists).toBe(false);
      expect(
        (await db.collection('taskOffers').doc(`gdpr-task-mine_${seed.babysitter1.uid}`).get())
          .exists,
      ).toBe(false);
      // The co-parent's task is family data with a surviving owner.
      expect((await db.collection('doTasks').doc('gdpr-task-coparent').get()).exists).toBe(true);
    });

    // The second round-1 blocker. Deleting the accepted offer without
    // touching the task left the family holding an `assigned` task that
    // named an erased uid, pointed at a deleted offer, and no retention path
    // ever collects (the sweep reaches expired-open, cancelled >30d and
    // completed >180d — never `assigned`).
    it("cancels and anonymizes a surviving family's task assigned to the erased doer", async () => {
      const offerId = await seedOffer(
        'gdpr-task-assigned',
        seed.babysitter1.uid,
        seed.family1Id,
        { status: 'accepted' },
      );
      await seedTask('gdpr-task-assigned', seed.family1Id, seed.parent2.uid, {
        status: 'assigned',
        assignedUserId: seed.babysitter1.uid,
        assignedOfferId: offerId,
        assignedAt: new Date(),
        agreedPrice: 40,
      });

      await callFunction('deleteUser', { targetUserId: seed.babysitter1.uid }, adminToken);

      const task = (await getDb().collection('doTasks').doc('gdpr-task-assigned').get()).data()!;
      // The family is unstuck: a terminal state the 30-day sweep reaches.
      expect(task.status).toBe('cancelled');
      expect(task.cancelledBy).toBe('admin');
      expect(task.cancelledAt).toBeTruthy();
      // No erased identifier survives on the live document.
      expect(task.assignedUserId).toBe('deleted');
      expect(task.assignedOfferId).toBeNull();
      // The price stays: it is the family's record of what was agreed, the
      // same way an anonymized past appointment keeps its scheduling detail.
      expect(task.agreedPrice).toBe(40);
      // And the offer itself is gone, doer-side personal data and all.
      expect((await getDb().collection('taskOffers').doc(offerId).get()).exists).toBe(false);

      const audit = await getDb()
        .collection('auditLogs')
        .where('action', '==', 'delete_user')
        .where('targetUserId', '==', seed.babysitter1.uid)
        .get();
      expect(audit.docs[0].data().details).toMatchObject({ clearedDoAssignments: 1 });
    });

    it('leaves a COMPLETED task as history, anonymized but not re-cancelled', async () => {
      await seedTask('gdpr-task-done', seed.family1Id, seed.parent2.uid, {
        status: 'completed',
        completedAt: new Date(),
        assignedUserId: seed.babysitter1.uid,
        assignedOfferId: 'gdpr-task-done_x',
        agreedPrice: 55,
      });

      await callFunction('deleteUser', { targetUserId: seed.babysitter1.uid }, adminToken);

      const task = (await getDb().collection('doTasks').doc('gdpr-task-done').get()).data()!;
      expect(task.status).toBe('completed');
      expect(task.cancelledAt ?? null).toBeNull();
      expect(task.assignedUserId).toBe('deleted');
      expect(task.agreedPrice).toBe(55);
    });

    it("deletes the family's remaining tasks when the LAST parent goes", async () => {
      await seedTask('gdpr-task-coparent', seed.family1Id, seed.parent2.uid);
      // parent1 first (co-parent survives), then parent2 as last parent.
      await callFunction('deleteUser', { targetUserId: seed.parent1.uid }, adminToken);
      expect(
        (await getDb().collection('doTasks').doc('gdpr-task-coparent').get()).exists,
      ).toBe(true);

      await callFunction('deleteUser', { targetUserId: seed.parent2.uid }, adminToken);
      expect(
        (await getDb().collection('doTasks').doc('gdpr-task-coparent').get()).exists,
      ).toBe(false);
    });
  });

  describe('deleteUser — photo objects and the dangling-reference scrub', () => {
    it("removes BOTH of the user's photo prefixes and leaves another user's alone", async () => {
      await seedPhoto(seed.parent1.uid, 'final-1');
      await seedPhoto(seed.parent1.uid, 'final-2');
      await seedPhoto(seed.parent1.uid, 'quarantine-1', 'do-uploads');
      await seedPhoto(seed.parent2.uid, 'coparent-1');
      await seedPhoto(seed.parent3.uid, 'stranger-1');

      await callFunction('deleteUser', { targetUserId: seed.parent1.uid }, adminToken);

      expect(await objectExists(`do-photos/${seed.parent1.uid}/final-1`)).toBe(false);
      expect(await objectExists(`do-photos/${seed.parent1.uid}/final-2`)).toBe(false);
      expect(await objectExists(`do-uploads/${seed.parent1.uid}/quarantine-1`)).toBe(false);
      // Erasure is prefix-scoped, so neither the co-parent nor an unrelated
      // family loses anything.
      expect(await objectExists(`do-photos/${seed.parent2.uid}/coparent-1`)).toBe(true);
      expect(await objectExists(`do-photos/${seed.parent3.uid}/stranger-1`)).toBe(true);
    });

    // §11.4's dangling-reference clause: `photos[]` may hold pairs from
    // EITHER parent, so erasing parent1's prefix can orphan entries a
    // still-live co-parent task points at — broken thumbnails, and
    // doGetTaskPhotoUrl signing URLs for deleted objects.
    it("scrubs the deleted uid's entries from a co-parent's SURVIVING task", async () => {
      await seedPhoto(seed.parent1.uid, 'mixed-p1');
      await seedPhoto(seed.parent2.uid, 'mixed-p2');
      await seedTask('gdpr-task-coparent', seed.family1Id, seed.parent2.uid, {
        photos: [
          { uid: seed.parent1.uid, photoId: 'mixed-p1' },
          { uid: seed.parent2.uid, photoId: 'mixed-p2' },
        ],
      });

      await callFunction('deleteUser', { targetUserId: seed.parent1.uid }, adminToken);

      const task = await getDb().collection('doTasks').doc('gdpr-task-coparent').get();
      expect(task.exists).toBe(true);
      // The co-parent's task is still valid: their own pair survives and
      // the deleted uid's is gone — no reference to a removed object.
      expect(task.data()!.photos).toEqual([
        { uid: seed.parent2.uid, photoId: 'mixed-p2' },
      ]);
      expect(await objectExists(`do-photos/${seed.parent1.uid}/mixed-p1`)).toBe(false);
      expect(await objectExists(`do-photos/${seed.parent2.uid}/mixed-p2`)).toBe(true);

      // And the audit entry records both halves of the erasure.
      const audit = await getDb()
        .collection('auditLogs')
        .where('action', '==', 'delete_user')
        .where('targetUserId', '==', seed.parent1.uid)
        .get();
      expect(audit.docs[0].data().details).toMatchObject({
        deletedDoPhotoObjects: 1,
        scrubbedDoTaskPhotos: 1,
      });
    });

    it("leaves an unrelated family's task and photos completely untouched", async () => {
      await seedPhoto(seed.parent1.uid, 'mine-1');
      await seedPhoto(seed.parent3.uid, 'theirs-1');
      await seedTask('gdpr-task-other', seed.family2Id, seed.parent3.uid, {
        photos: [{ uid: seed.parent3.uid, photoId: 'theirs-1' }],
      });
      await seedOffer('gdpr-task-other', seed.babysitter2.uid, seed.family2Id);

      await callFunction('deleteUser', { targetUserId: seed.parent1.uid }, adminToken);

      const other = await getDb().collection('doTasks').doc('gdpr-task-other').get();
      expect(other.exists).toBe(true);
      expect(other.data()!.photos).toEqual([
        { uid: seed.parent3.uid, photoId: 'theirs-1' },
      ]);
      expect(
        (await getDb().collection('taskOffers').doc(`gdpr-task-other_${seed.babysitter2.uid}`).get())
          .exists,
      ).toBe(true);
      expect(await objectExists(`do-photos/${seed.parent3.uid}/theirs-1`)).toBe(true);
    });
  });
});
