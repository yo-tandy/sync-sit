import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb, getAdminAuth, parisDateFromNow } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

// PR5 lifecycle (plan §13): post → update → cancel → complete, no offers
// yet (offers land at PR6 — assigned states are seeded directly). Photo
// behaviour lives in task-photos.test.ts; the sweep in sweep-tasks.test.ts.

const DOER_UID = 'doer-lifecycle-1';
const DAY_MS = 24 * 60 * 60 * 1000;

/** A minimal valid ongoing-task payload (family1 = verified Dupont). */
function ongoingPayload(overrides: Record<string, unknown> = {}) {
  return {
    category: 'green_thumb',
    subCategory: 'green_thumb_garden_watering',
    title: 'Water the terrace plants',
    description: 'Twice a week while we travel.',
    photos: [],
    timing: 'ongoing',
    startDate: parisDateFromNow(1),
    cadence: { kind: 'weekly', days: ['tue', 'fri'] },
    adultPresent: 'no',
    transportNeeded: false,
    ...overrides,
  };
}

/** Seed an ASSIGNED task directly (acceptance is PR6's callable). */
async function seedAssignedTask(taskId: string, familyId: string, assignedUserId: string) {
  const now = new Date();
  await getDb().collection('doTasks').doc(taskId).set({
    taskId, familyId, createdByUserId: 'seed-parent',
    familyName: 'Dupont', areaLabel: '16e',
    category: 'ikea', subCategory: 'ikea_assembly',
    title: 'Assemble a PAX', description: 'Two-door PAX with mirror.',
    photos: [],
    timing: 'deadline', date: null, startTime: null, endTime: null,
    dueDate: parisDateFromNow(10), startDate: null, endDate: null, cadence: null,
    estimatedHours: null, suggestedBudget: null,
    adultPresent: 'yes', toolsProvided: true, transportNeeded: false,
    status: 'assigned', offerCount: 0,
    assignedUserId, assignedOfferId: `${taskId}_${assignedUserId}`,
    assignedAt: now, agreedPrice: 40,
    doerMarkedDoneAt: null, completedAt: null, cancelledAt: null, cancelledBy: null,
    createdAt: now, updatedAt: now,
    expiresAt: new Date(now.getTime() + 10 * DAY_MS),
  });
}

describe('task lifecycle callables', () => {
  let seed: SeedData;
  let parent1Token: string; // verified family (Dupont)
  let parent2Token: string; // co-parent, same family
  let unverifiedParentToken: string; // family-martin, not verified
  let doerToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    // The Dupont family gets the address fields decision 17 requires.
    await getDb().collection('families').doc(seed.family1Id).update({
      postcode: '75016', city: 'Paris',
    });
    await getAdminAuth().createUser({ uid: DOER_UID, email: 'doer.lifecycle@ejm.org' });
    await getDb().collection('users').doc(DOER_UID).set({
      uid: DOER_UID, email: 'doer.lifecycle@ejm.org', status: 'active',
      firstName: 'Dora', lastName: 'Doer', dateOfBirth: new Date('2008-01-01'),
      profiles: {
        doer: {
          enrollmentComplete: true, notifyNewTasks: true,
          categories: ['ikea'], bio: null, defaultRate: null,
          hasCar: false, hasBike: true,
        },
      },
      notifPrefs: {}, fcmTokens: [], createdAt: new Date(), updatedAt: new Date(),
    });
    parent1Token = await getIdToken(seed.parent1.uid);
    parent2Token = await getIdToken(seed.parent2.uid);
    unverifiedParentToken = await getIdToken(seed.parent3.uid);
    doerToken = await getIdToken(DOER_UID);
  });

  afterAll(async () => {
    await clearAll();
  });

  describe('doPostTask', () => {
    it('rejects unauthenticated calls', async () => {
      await expect(callFunction('doPostTask', ongoingPayload()))
        .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    // The three posting-gate refusals share one code, so each must carry its
    // own `details.reason` (issue #333) — without it the wizard can only
    // print the union of all three and accuse the parent of the two that are
    // actually fine.
    it('rejects a non-parent (doer) caller, saying WHICH gate refused', async () => {
      await expect(callFunction('doPostTask', ongoingPayload(), doerToken))
        .rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
          details: { reason: 'not_parent' },
        });
    });

    it('rejects an unverified family — decision 14, portable verification gate', async () => {
      await expect(callFunction('doPostTask', ongoingPayload(), unverifiedParentToken))
        .rejects.toMatchObject({
          code: 'PERMISSION_DENIED',
          details: { reason: 'family_not_verified' },
        });
    });

    it('rejects a SUSPENDED parent of a verified family with its own reason', async () => {
      // The case the union copy served worst: nothing is wrong with this
      // family's verification, only with the account.
      const ref = getDb().collection('users').doc(seed.parent1.uid);
      await ref.update({ status: 'suspended' });
      try {
        await expect(callFunction('doPostTask', ongoingPayload(), parent1Token))
          .rejects.toMatchObject({
            code: 'PERMISSION_DENIED',
            details: { reason: 'account_not_active' },
          });
      } finally {
        await ref.update({ status: 'active' });
      }
    });

    it('refuses address_required when the family postcode/city resolves no label (decision 17)', async () => {
      const db = getDb();
      const { FieldValue } = await import('firebase-admin/firestore');
      await db.collection('families').doc(seed.family1Id).update({
        postcode: FieldValue.delete(), city: FieldValue.delete(),
      });
      try {
        await expect(callFunction('doPostTask', ongoingPayload(), parent1Token))
          .rejects.toMatchObject({
            code: 'FAILED_PRECONDITION',
            details: { reason: 'address_required' },
          });
      } finally {
        await db.collection('families').doc(seed.family1Id).update({
          postcode: '75016', city: 'Paris',
        });
      }
    });

    it('posts an ongoing task: server-computed areaLabel, expiresAt = now + 14d, §4.1 shape', async () => {
      const before = Date.now();
      const { taskId } = await callFunction<{ taskId: string }>(
        'doPostTask', ongoingPayload(), parent1Token,
      );
      const task = (await getDb().collection('doTasks').doc(taskId).get()).data()!;
      expect(task.status).toBe('open');
      expect(task.offerCount).toBe(0);
      expect(task.familyId).toBe(seed.family1Id);
      expect(task.createdByUserId).toBe(seed.parent1.uid);
      expect(task.areaLabel).toBe('16e'); // resolveAreaLabel('75016')
      expect(task.familyName).toBe('Dupont');
      expect(task.assignedUserId).toBeNull();
      expect(task.doerMarkedDoneAt).toBeNull();
      expect(task.date).toBeNull(); // normalized stored nulls for other groups
      expect(task.dueDate).toBeNull();
      const expMs = task.expiresAt.toDate().getTime();
      expect(expMs).toBeGreaterThanOrEqual(before + 14 * DAY_MS - 5000);
      expect(expMs).toBeLessThanOrEqual(Date.now() + 14 * DAY_MS + 5000);
      await getDb().collection('doTasks').doc(taskId).delete();
    });

    it('a fixed task expires at the end of its Paris day, not at a TTL', async () => {
      const date = parisDateFromNow(30); // far beyond the 14d ongoing TTL
      const { taskId } = await callFunction<{ taskId: string }>('doPostTask', ongoingPayload({
        timing: 'fixed', date, startTime: '14:00', endTime: '17:00',
        startDate: undefined, cadence: undefined,
      }), parent1Token);
      const task = (await getDb().collection('doTasks').doc(taskId).get()).data()!;
      const expMs = task.expiresAt.toDate().getTime();
      // End of that Paris day is ~30d out — far past now + 14d.
      expect(expMs).toBeGreaterThan(Date.now() + 20 * DAY_MS);
      await getDb().collection('doTasks').doc(taskId).delete();
    });

    it('rejects invalid input: bad category pair, partial timing group, past date', async () => {
      await expect(callFunction('doPostTask', ongoingPayload({ subCategory: 'ikea_assembly' }), parent1Token))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(callFunction('doPostTask', ongoingPayload({
        timing: 'fixed', date: parisDateFromNow(3), // no startTime/endTime
        startDate: undefined, cadence: undefined,
      }), parent1Token)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(callFunction('doPostTask', ongoingPayload({
        timing: 'deadline', dueDate: parisDateFromNow(-2),
        startDate: undefined, cadence: undefined,
      }), parent1Token)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(callFunction('doPostTask', ongoingPayload({ adultPresent: 'maybe' }), parent1Token))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(callFunction('doPostTask', ongoingPayload({ transportNeeded: undefined }), parent1Token))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('enforces DO_TASK_MAX_ACTIVE (5 open per family) and cancel returns the slot', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { taskId } = await callFunction<{ taskId: string }>(
          'doPostTask', ongoingPayload({ title: `Task ${i}` }), parent1Token,
        );
        ids.push(taskId);
      }
      await expect(callFunction('doPostTask', ongoingPayload({ title: 'One too many' }), parent1Token))
        .rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED', details: { reason: 'task_cap' } });

      // Cancel one → the slot comes back (the ceiling counts OPEN tasks).
      await callFunction('doCancelTask', { taskId: ids[0] }, parent1Token);
      const { taskId: sixth } = await callFunction<{ taskId: string }>(
        'doPostTask', ongoingPayload({ title: 'Fits again' }), parent1Token,
      );
      ids.push(sixth);
      // Cleanup
      for (const id of ids) {
        await getDb().collection('doTasks').doc(id).delete();
      }
    });
  });

  describe('doUpdateTask', () => {
    let taskId: string;

    beforeAll(async () => {
      ({ taskId } = await callFunction<{ taskId: string }>(
        'doPostTask', ongoingPayload({ title: 'Editable task' }), parent1Token,
      ));
    });

    afterAll(async () => {
      await getDb().collection('doTasks').doc(taskId).delete();
    });

    it('rejects a non-owner family and a doer', async () => {
      await expect(callFunction('doUpdateTask', { taskId, description: 'hijack' }, unverifiedParentToken))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(callFunction('doUpdateTask', { taskId, description: 'hijack' }, doerToken))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('the CO-PARENT can edit (owner family, not just the poster)', async () => {
      await callFunction('doUpdateTask', { taskId, suggestedBudget: 25 }, parent2Token);
      const task = (await getDb().collection('doTasks').doc(taskId).get()).data()!;
      expect(task.suggestedBudget).toBe(25);
    });

    it('an empty payload IS the renew tap: expiresAt recomputes to now + 14d (§6.3)', async () => {
      const db = getDb();
      // Backdate the expiry to simulate an ageing standing post.
      const stale = new Date(Date.now() + 2 * DAY_MS);
      await db.collection('doTasks').doc(taskId).update({ expiresAt: stale });
      await callFunction('doUpdateTask', { taskId }, parent1Token);
      const task = (await db.collection('doTasks').doc(taskId).get()).data()!;
      const expMs = task.expiresAt.toDate().getTime();
      expect(expMs).toBeGreaterThan(Date.now() + 13 * DAY_MS);
    });

    it('updates description and the whole timing group; partial groups are refused', async () => {
      await callFunction('doUpdateTask', {
        taskId,
        description: 'Now a dated deadline job.',
        timing: 'deadline', dueDate: parisDateFromNow(5),
      }, parent1Token);
      const task = (await getDb().collection('doTasks').doc(taskId).get()).data()!;
      expect(task.description).toBe('Now a dated deadline job.');
      expect(task.timing).toBe('deadline');
      expect(task.dueDate).toBe(parisDateFromNow(5));
      expect(task.startDate).toBeNull(); // the old group normalized away
      expect(task.cadence).toBeNull();

      await expect(callFunction('doUpdateTask', { taskId, dueDate: parisDateFromNow(9) }, parent1Token))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('rejects edits on a non-open task', async () => {
      await seedAssignedTask('lifecycle-assigned-edit', seed.family1Id, DOER_UID);
      await expect(callFunction('doUpdateTask', { taskId: 'lifecycle-assigned-edit', description: 'too late' }, parent1Token))
        .rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
      await getDb().collection('doTasks').doc('lifecycle-assigned-edit').delete();
    });
  });

  describe('doCancelTask', () => {
    it('family cancels an OPEN task; live offers sweep to expired and offerCount zeroes (§4.1)', async () => {
      const db = getDb();
      const { taskId } = await callFunction<{ taskId: string }>(
        'doPostTask', ongoingPayload({ title: 'Cancel me' }), parent1Token,
      );
      // Seed live + non-live offers (offers are PR6; the sweep is generic).
      await db.collection('doTasks').doc(taskId).update({ offerCount: 2 });
      const offers = {
        [`${taskId}_o1`]: 'pending',
        [`${taskId}_o2`]: 'pending_guardian',
        [`${taskId}_o3`]: 'withdrawn',
      };
      for (const [offerId, status] of Object.entries(offers)) {
        await db.collection('taskOffers').doc(offerId).set({
          offerId, taskId, doerUserId: `d-${offerId}`, familyId: seed.family1Id,
          status, createdAt: new Date(), updatedAt: new Date(),
        });
      }

      const res = await callFunction<{ cancelledBy: string }>('doCancelTask', { taskId }, parent1Token);
      expect(res.cancelledBy).toBe('family');
      const task = (await db.collection('doTasks').doc(taskId).get()).data()!;
      expect(task.status).toBe('cancelled');
      expect(task.cancelledBy).toBe('family');
      expect(task.cancelledAt).not.toBeNull();
      expect(task.offerCount).toBe(0);
      expect((await db.collection('taskOffers').doc(`${taskId}_o1`).get()).data()!.status).toBe('expired');
      expect((await db.collection('taskOffers').doc(`${taskId}_o2`).get()).data()!.status).toBe('expired');
      // A non-live offer is untouched — only the live set sweeps.
      expect((await db.collection('taskOffers').doc(`${taskId}_o3`).get()).data()!.status).toBe('withdrawn');

      for (const offerId of Object.keys(offers)) {
        await db.collection('taskOffers').doc(offerId).delete();
      }
      await db.collection('doTasks').doc(taskId).delete();
    });

    it('a slashed taskId is invalid-argument, never a path traversal or an internal error', async () => {
      await expect(callFunction('doCancelTask', { taskId: 'a/b' }, parent1Token))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(callFunction('doMarkTaskDone', { taskId: 'a/b/c/d' }, parent1Token))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(callFunction('doUpdateTask', { taskId: 'a/b' }, parent1Token))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(callFunction('doGetTaskPhotoUrl', { taskId: 'a/b', photoId: 'p1' }, parent1Token))
        .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('a doer cannot cancel an OPEN task (family only)', async () => {
      const { taskId } = await callFunction<{ taskId: string }>(
        'doPostTask', ongoingPayload({ title: 'Not yours to cancel' }), parent1Token,
      );
      await expect(callFunction('doCancelTask', { taskId }, doerToken))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await getDb().collection('doTasks').doc(taskId).delete();
    });

    it('the ASSIGNED doer can cancel an assigned task — cancelledBy records doer (§6.5)', async () => {
      await seedAssignedTask('lifecycle-cancel-doer', seed.family1Id, DOER_UID);
      const res = await callFunction<{ cancelledBy: string }>(
        'doCancelTask', { taskId: 'lifecycle-cancel-doer' }, doerToken,
      );
      expect(res.cancelledBy).toBe('doer');
      const task = (await getDb().collection('doTasks').doc('lifecycle-cancel-doer').get()).data()!;
      expect(task.status).toBe('cancelled');
      expect(task.cancelledBy).toBe('doer');
      await getDb().collection('doTasks').doc('lifecycle-cancel-doer').delete();
    });

    it('a NON-assigned doer cannot cancel an assigned task; a completed task cannot be cancelled', async () => {
      await seedAssignedTask('lifecycle-cancel-other', seed.family1Id, 'someone-else');
      await expect(callFunction('doCancelTask', { taskId: 'lifecycle-cancel-other' }, doerToken))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await getDb().collection('doTasks').doc('lifecycle-cancel-other').update({
        status: 'completed', completedAt: new Date(),
      });
      await expect(callFunction('doCancelTask', { taskId: 'lifecycle-cancel-other' }, parent1Token))
        .rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
      await getDb().collection('doTasks').doc('lifecycle-cancel-other').delete();
    });
  });

  describe('doMarkTaskDone', () => {
    it("the student's mark sets doerMarkedDoneAt and the task STAYS assigned; re-marks are idempotent", async () => {
      await seedAssignedTask('lifecycle-done-doer', seed.family1Id, DOER_UID);
      const res = await callFunction<{ result: string }>(
        'doMarkTaskDone', { taskId: 'lifecycle-done-doer' }, doerToken,
      );
      expect(res.result).toBe('marked');
      const task = (await getDb().collection('doTasks').doc('lifecycle-done-doer').get()).data()!;
      expect(task.status).toBe('assigned');
      expect(task.doerMarkedDoneAt).not.toBeNull();
      const firstMark = task.doerMarkedDoneAt.toDate().getTime();

      // Idempotent re-mark: no error, the ORIGINAL timestamp stands (the
      // sweep's 7-day auto-complete clock must not restart).
      await callFunction('doMarkTaskDone', { taskId: 'lifecycle-done-doer' }, doerToken);
      const again = (await getDb().collection('doTasks').doc('lifecycle-done-doer').get()).data()!;
      expect(again.doerMarkedDoneAt.toDate().getTime()).toBe(firstMark);
      await getDb().collection('doTasks').doc('lifecycle-done-doer').delete();
    });

    it("the family's mark completes the task (with or without a prior doer mark)", async () => {
      await seedAssignedTask('lifecycle-done-family', seed.family1Id, DOER_UID);
      const res = await callFunction<{ result: string }>(
        'doMarkTaskDone', { taskId: 'lifecycle-done-family' }, parent2Token,
      );
      expect(res.result).toBe('completed');
      const task = (await getDb().collection('doTasks').doc('lifecycle-done-family').get()).data()!;
      expect(task.status).toBe('completed');
      expect(task.completedAt).not.toBeNull();
      await getDb().collection('doTasks').doc('lifecycle-done-family').delete();
    });

    it('a non-party cannot mark; an open task cannot be marked', async () => {
      await seedAssignedTask('lifecycle-done-npc', seed.family1Id, 'someone-else');
      await expect(callFunction('doMarkTaskDone', { taskId: 'lifecycle-done-npc' }, doerToken))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(callFunction('doMarkTaskDone', { taskId: 'lifecycle-done-npc' }, unverifiedParentToken))
        .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await getDb().collection('doTasks').doc('lifecycle-done-npc').delete();

      const { taskId } = await callFunction<{ taskId: string }>(
        'doPostTask', ongoingPayload({ title: 'Still open' }), parent1Token,
      );
      await expect(callFunction('doMarkTaskDone', { taskId }, parent1Token))
        .rejects.toMatchObject({ code: 'FAILED_PRECONDITION' });
      await getDb().collection('doTasks').doc(taskId).delete();
    });
  });
});
