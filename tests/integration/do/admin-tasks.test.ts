import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

// PR10's admin surface (plan §8's two rows, §9.4, §14's admin tests):
// doAdminListTasks (filters + the offers detail mode) and doAdminDeleteTask
// (hard delete + cascade + audit). Both are Admin-SDK callables behind
// verifyAdmin, so the negative half — a non-admin is refused — is the pin
// that keeps the whole `doTasks` collection from being enumerable by any
// authenticated account.

const DAY_MS = 24 * 60 * 60 * 1000;

interface ListResponse {
  tasks: {
    id: string;
    title: string;
    familyId: string;
    familyName: string;
    category: string;
    status: string;
    offerCount: number;
    photoCount: number;
    areaLabel: string;
  }[];
  offers: {
    id: string;
    doerUserId: string;
    status: string;
    price: number | null;
    helper: { firstName: string; lastName: string; age: number } | null;
  }[];
  hasMore: boolean;
}

interface DeleteResponse {
  success: boolean;
  taskId: string;
  offersDeleted: number;
  photoObjectsDeleted: number;
}

async function seedTask(
  taskId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date();
  await getDb()
    .collection('doTasks')
    .doc(taskId)
    .set({
      taskId,
      familyId: 'family-admin-1',
      createdByUserId: 'parent-admin-1',
      familyName: 'Dupont',
      areaLabel: '16e',
      category: 'ikea',
      subCategory: 'ikea_assembly',
      title: 'Assemble a PAX',
      description: 'Two-door PAX with mirror.',
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
      familyId: 'family-admin-1',
      doerFirstName: 'Dora',
      doerPhotoUrl: null,
      doerBio: null,
      taskTitle: 'Assemble a PAX',
      taskCategory: 'ikea',
      taskTiming: 'deadline',
      price: 40,
      priceBasis: 'flat',
      message: 'I have assembled three of these.',
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

describe('sync-do admin callables', () => {
  let seed: SeedData;
  let adminToken: string;
  let parentToken: string;
  let babysitterToken: string;

  beforeAll(async () => {
    await clearAll();
    await clearStoragePrefix('do-photos/');
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
    parentToken = await getIdToken(seed.parent1.uid);
    babysitterToken = await getIdToken(seed.babysitter1.uid);

    // Three tasks in one family, one in another, spanning categories and
    // statuses so every filter has both a hit and a miss to prove.
    await seedTask('admin-task-open-ikea');
    await seedTask('admin-task-open-garden', {
      category: 'green_thumb',
      subCategory: 'green_thumb_garden_watering',
      title: 'Water the terrace plants',
    });
    await seedTask('admin-task-done-ikea', {
      status: 'completed',
      completedAt: new Date(),
      title: 'Old bookcase build',
    });
    await seedTask('admin-task-other-family', {
      familyId: 'family-admin-2',
      familyName: 'Martin',
      areaLabel: '15e',
      title: 'Carry boxes to the cellar',
      category: 'boxes',
      subCategory: 'boxes_moving',
    });
  });

  afterAll(async () => {
    await clearStoragePrefix('do-photos/');
    await clearAll();
  });

  describe('doAdminListTasks — authorization', () => {
    it('refuses an unauthenticated caller', async () => {
      await expect(callFunction('doAdminListTasks', {})).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    // The load-bearing negative: `doTasks` has no client read rule for a
    // parent outside the owning family and none at all for a babysitter, so
    // a missing verifyAdmin here would expose every family's free text.
    it('refuses an authenticated NON-admin parent', async () => {
      await expect(
        callFunction('doAdminListTasks', {}, parentToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('refuses an authenticated non-admin babysitter', async () => {
      await expect(
        callFunction('doAdminListTasks', {}, babysitterToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });
  });

  describe('doAdminListTasks — listing and filters', () => {
    it('lists every task for an admin', async () => {
      const res = await callFunction<ListResponse>('doAdminListTasks', {}, adminToken);
      expect(res.tasks.map((t) => t.id).sort()).toEqual([
        'admin-task-done-ikea',
        'admin-task-open-garden',
        'admin-task-open-ikea',
        'admin-task-other-family',
      ]);
    });

    it('filters by status', async () => {
      const res = await callFunction<ListResponse>(
        'doAdminListTasks',
        { statusFilter: 'completed' },
        adminToken,
      );
      expect(res.tasks.map((t) => t.id)).toEqual(['admin-task-done-ikea']);
    });

    it('filters by category', async () => {
      const res = await callFunction<ListResponse>(
        'doAdminListTasks',
        { categoryFilter: 'green_thumb' },
        adminToken,
      );
      expect(res.tasks.map((t) => t.id)).toEqual(['admin-task-open-garden']);
    });

    it('filters by family', async () => {
      const res = await callFunction<ListResponse>(
        'doAdminListTasks',
        { familyIdFilter: 'family-admin-2' },
        adminToken,
      );
      expect(res.tasks.map((t) => t.id)).toEqual(['admin-task-other-family']);
    });

    // Every filter at once: the combination the four PR10 composites exist
    // for. Without them this query fails outright in production, and the
    // emulator would not tell us.
    it('combines status + category + family', async () => {
      const res = await callFunction<ListResponse>(
        'doAdminListTasks',
        { statusFilter: 'open', categoryFilter: 'ikea', familyIdFilter: 'family-admin-1' },
        adminToken,
      );
      expect(res.tasks.map((t) => t.id)).toEqual(['admin-task-open-ikea']);
    });

    it('searches free text across title, family name and area', async () => {
      const byTitle = await callFunction<ListResponse>(
        'doAdminListTasks',
        { searchQuery: 'terrace' },
        adminToken,
      );
      expect(byTitle.tasks.map((t) => t.id)).toEqual(['admin-task-open-garden']);

      const byFamily = await callFunction<ListResponse>(
        'doAdminListTasks',
        { searchQuery: 'martin' },
        adminToken,
      );
      expect(byFamily.tasks.map((t) => t.id)).toEqual(['admin-task-other-family']);

      const noHit = await callFunction<ListResponse>(
        'doAdminListTasks',
        { searchQuery: 'nothing-matches-this' },
        adminToken,
      );
      expect(noHit.tasks).toEqual([]);
    });
  });

  describe('doAdminListTasks — the offers detail mode (§9.4)', () => {
    it('returns a task with every offer on it, including pending_guardian', async () => {
      await seedOffer('admin-task-open-ikea', 'doer-admin-1');
      await seedOffer('admin-task-open-ikea', 'doer-admin-2', {
        status: 'pending_guardian',
        doerFirstName: 'Gus',
        price: 55,
        helper: { firstName: 'Leo', lastName: 'Martin', age: 14 },
        guardian: { required: true, familyId: 'family-guard-1', decidedAt: null, decidedByUid: null },
      });
      await seedOffer('admin-task-open-ikea', 'doer-admin-3', { status: 'withdrawn' });
      // A decoy on the sibling task: the detail mode must not leak it.
      await seedOffer('admin-task-open-garden', 'doer-admin-1');

      const res = await callFunction<ListResponse>(
        'doAdminListTasks',
        { taskId: 'admin-task-open-ikea' },
        adminToken,
      );
      expect(res.tasks.map((t) => t.id)).toEqual(['admin-task-open-ikea']);
      expect(res.offers.map((o) => o.doerUserId).sort()).toEqual([
        'doer-admin-1',
        'doer-admin-2',
        'doer-admin-3',
      ]);
      expect(res.offers.map((o) => o.status).sort()).toEqual([
        'pending',
        'pending_guardian',
        'withdrawn',
      ]);
      // The §11.3 +1 helper is visible to admin: it is the disclosure a
      // family may later ask about, and §11.5 makes admin the party who
      // reconstructs what was agreed.
      const guardianOffer = res.offers.find((o) => o.doerUserId === 'doer-admin-2')!;
      expect(guardianOffer.helper).toEqual({ firstName: 'Leo', lastName: 'Martin', age: 14 });
    });

    it('refuses a non-admin in detail mode too', async () => {
      await expect(
        callFunction('doAdminListTasks', { taskId: 'admin-task-open-ikea' }, parentToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('404s an unknown taskId', async () => {
      await expect(
        callFunction('doAdminListTasks', { taskId: 'no-such-task' }, adminToken),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('doAdminDeleteTask', () => {
    it('refuses a non-admin', async () => {
      await expect(
        callFunction('doAdminDeleteTask', { taskId: 'admin-task-open-garden' }, parentToken),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      const still = await getDb().collection('doTasks').doc('admin-task-open-garden').get();
      expect(still.exists).toBe(true);
    });

    it('hard-deletes the task, cascades its offers and photos, and audits', async () => {
      await seedTask('admin-task-to-delete', {
        title: 'Delete me',
        photos: [{ uid: 'parent-admin-1', photoId: 'del-photo-1' }],
      });
      await seedOffer('admin-task-to-delete', 'doer-admin-9');
      await getBucket()
        .file('do-photos/parent-admin-1/del-photo-1')
        .save(Buffer.from([0xff, 0xd8, 0xff, 0xdb]), {
          resumable: false,
          metadata: { contentType: 'image/jpeg' },
        });

      const res = await callFunction<DeleteResponse>(
        'doAdminDeleteTask',
        { taskId: 'admin-task-to-delete' },
        adminToken,
      );
      expect(res.success).toBe(true);
      expect(res.offersDeleted).toBe(1);
      expect(res.photoObjectsDeleted).toBe(1);

      const db = getDb();
      expect((await db.collection('doTasks').doc('admin-task-to-delete').get()).exists).toBe(false);
      const offers = await db
        .collection('taskOffers')
        .where('taskId', '==', 'admin-task-to-delete')
        .get();
      expect(offers.empty).toBe(true);
      const [photoExists] = await getBucket()
        .file('do-photos/parent-admin-1/del-photo-1')
        .exists();
      expect(photoExists).toBe(false);

      const audit = await db
        .collection('auditLogs')
        .where('action', '==', 'do.admin_delete_task')
        .get();
      const entry = audit.docs.map((d) => d.data()).find(
        (d) => (d.details as Record<string, unknown>)?.taskId === 'admin-task-to-delete',
      )!;
      expect(entry).toBeTruthy();
      expect(entry.adminUserId).toBe(seed.admin.uid);
      expect(entry.targetUserId).toBe('parent-admin-1');
      expect(entry.details).toMatchObject({
        familyId: 'family-admin-1',
        status: 'open',
        category: 'ikea',
        offersDeleted: 1,
        photoObjectsDeleted: 1,
      });
    });

    // The sweep's guard, inherited by the shared cascade: a pair a sibling
    // task still references must survive, or deleting one task 404s the
    // other's thumbnail with no way to re-attach.
    it('leaves a photo object a sibling task still references', async () => {
      await getBucket()
        .file('do-photos/parent-admin-1/shared-photo')
        .save(Buffer.from([0xff, 0xd8, 0xff, 0xdb]), {
          resumable: false,
          metadata: { contentType: 'image/jpeg' },
        });
      await seedTask('admin-task-shares-a', {
        photos: [{ uid: 'parent-admin-1', photoId: 'shared-photo' }],
      });
      await seedTask('admin-task-shares-b', {
        photos: [{ uid: 'parent-admin-1', photoId: 'shared-photo' }],
      });

      const res = await callFunction<DeleteResponse>(
        'doAdminDeleteTask',
        { taskId: 'admin-task-shares-a' },
        adminToken,
      );
      expect(res.photoObjectsDeleted).toBe(0);
      const [stillThere] = await getBucket()
        .file('do-photos/parent-admin-1/shared-photo')
        .exists();
      expect(stillThere).toBe(true);
    });

    it('404s an unknown taskId and rejects a malformed one', async () => {
      await expect(
        callFunction('doAdminDeleteTask', { taskId: 'no-such-task' }, adminToken),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        callFunction('doAdminDeleteTask', { taskId: 'a/b' }, adminToken),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });
  });
});
