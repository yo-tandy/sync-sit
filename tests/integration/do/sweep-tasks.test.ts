import { createRequire } from 'module';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { clearAll, getDb, getBucket, clearStoragePrefix } from '../../setup/emulator.js';

const require = createRequire(import.meta.url);
// Imported from the compiled dist like the cleanup-old-data suite: the
// sweep rides the cleanupOldData schedule (§8 — one daily job), so the
// testable unit is the extracted runner.
const { runDoSweepTasks } = require(
  '../../../apps/functions/dist/do/sweepTasks.js'
) as typeof import('../../../apps/functions/src/do/sweepTasks.js');

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * DAY_MS);
}

/** Seed a doTasks doc with only the sweep-relevant fields explicit. */
async function seedTask(taskId: string, overrides: Record<string, unknown>) {
  await getDb().collection('doTasks').doc(taskId).set({
    taskId, familyId: 'sweep-family', createdByUserId: 'sweep-parent',
    familyName: 'Sweep', areaLabel: '16e',
    category: 'boxes', subCategory: 'boxes_moving_help',
    title: 'Sweep fixture', description: 'x', photos: [],
    timing: 'ongoing', date: null, startTime: null, endTime: null,
    dueDate: null, startDate: '2026-08-01', endDate: null,
    cadence: { kind: 'daily' }, estimatedHours: null, suggestedBudget: null,
    adultPresent: 'yes', toolsProvided: null, transportNeeded: false,
    status: 'open', offerCount: 0,
    assignedUserId: null, assignedOfferId: null, assignedAt: null,
    agreedPrice: null, doerMarkedDoneAt: null, completedAt: null,
    cancelledAt: null, cancelledBy: null,
    createdAt: daysAgo(200), updatedAt: daysAgo(1), expiresAt: daysFromNow(7),
    ...overrides,
  });
}

async function seedOffer(offerId: string, taskId: string, status: string) {
  await getDb().collection('taskOffers').doc(offerId).set({
    offerId, taskId, doerUserId: `doer-${offerId}`, familyId: 'sweep-family',
    status, createdAt: daysAgo(10), updatedAt: daysAgo(10),
  });
}

async function taskExists(taskId: string): Promise<boolean> {
  return (await getDb().collection('doTasks').doc(taskId).get()).exists;
}

describe('runDoSweepTasks (rides the cleanupOldData schedule)', () => {
  beforeAll(async () => {
    await clearAll();
  });

  afterAll(async () => {
    await clearStoragePrefix('do-photos/');
    await clearStoragePrefix('do-uploads/');
    await clearAll();
  });

  beforeEach(async () => {
    const db = getDb();
    for (const col of ['doTasks', 'taskOffers', 'cronState']) {
      const docs = await db.collection(col).get();
      await Promise.all(docs.docs.map((d) => d.ref.delete()));
    }
    await clearStoragePrefix('do-photos/');
    await clearStoragePrefix('do-uploads/');
    // The side bucket too (see the quarantine test for why it exists).
    const [sideFiles] = await getBucket('do-sweep-side-bucket').getFiles();
    await Promise.all(sideFiles.map((f) => f.delete({ ignoreNotFound: true })));
  });

  it('deletes expired OPEN tasks with their offers AND their photo objects; keeps live ones (§6.3, §11.4)', async () => {
    const bucket = getBucket();
    await bucket.file('do-photos/sweep-u1/expired-photo').save(Buffer.from([1, 2, 3]), {
      resumable: false, metadata: { contentType: 'image/jpeg' },
    });
    await bucket.file('do-photos/sweep-u1/live-photo').save(Buffer.from([4, 5, 6]), {
      resumable: false, metadata: { contentType: 'image/jpeg' },
    });
    await seedTask('sweep-expired', {
      expiresAt: daysAgo(1),
      photos: [{ uid: 'sweep-u1', photoId: 'expired-photo' }],
    });
    await seedTask('sweep-live', {
      expiresAt: daysFromNow(3),
      photos: [{ uid: 'sweep-u1', photoId: 'live-photo' }],
    });
    await seedOffer('sweep-expired_o1', 'sweep-expired', 'pending');
    await seedOffer('sweep-expired_o2', 'sweep-expired', 'withdrawn');
    await seedOffer('sweep-live_o1', 'sweep-live', 'pending');

    const stats = await runDoSweepTasks(getDb(), bucket, new Date());

    expect(stats.expiredTasksDeleted).toBe(1);
    expect(stats.offersDeleted).toBe(2); // BOTH of the expired task's offers, any status
    expect(await taskExists('sweep-expired')).toBe(false);
    expect(await taskExists('sweep-live')).toBe(true);
    expect((await getDb().collection('taskOffers').doc('sweep-expired_o1').get()).exists).toBe(false);
    expect((await getDb().collection('taskOffers').doc('sweep-expired_o2').get()).exists).toBe(false);
    expect((await getDb().collection('taskOffers').doc('sweep-live_o1').get()).exists).toBe(true);
    // The deleted task's photo object left WITH it; the live task's stayed.
    expect((await bucket.file('do-photos/sweep-u1/expired-photo').exists())[0]).toBe(false);
    expect((await bucket.file('do-photos/sweep-u1/live-photo').exists())[0]).toBe(true);
  });

  it('a photo pair SHARED with a still-live task survives the cascade (only the last reference deletes)', async () => {
    const bucket = getBucket();
    await bucket.file('do-photos/sweep-u5/shared-photo').save(Buffer.from([7, 8, 9]), {
      resumable: false, metadata: { contentType: 'image/jpeg' },
    });
    const pair = { uid: 'sweep-u5', photoId: 'shared-photo' };
    await seedTask('sweep-shared-expired', { expiresAt: daysAgo(1), photos: [pair] });
    await seedTask('sweep-shared-live', { expiresAt: daysFromNow(5), photos: [pair] });

    let stats = await runDoSweepTasks(getDb(), bucket, new Date());
    expect(stats.expiredTasksDeleted).toBe(1);
    expect(await taskExists('sweep-shared-expired')).toBe(false);
    // The LIVE task still references the pair — the object must survive.
    expect((await bucket.file('do-photos/sweep-u5/shared-photo').exists())[0]).toBe(true);

    // Once the last referencing task goes, the cascade collects the object.
    await getDb().collection('doTasks').doc('sweep-shared-live').update({ expiresAt: daysAgo(1) });
    stats = await runDoSweepTasks(getDb(), bucket, new Date());
    expect(stats.expiredTasksDeleted).toBe(1);
    expect((await bucket.file('do-photos/sweep-u5/shared-photo').exists())[0]).toBe(false);
  });

  it('a task with more offers than one Firestore batch holds (>400) still cascades cleanly', async () => {
    // The cascade chunks its offer deletes below the 500-writes batch cap:
    // one oversized task must not become a poison pill the sweep dies on
    // every day (DO_OFFER_MAX_PER_TASK caps LIVE offers only).
    const db = getDb();
    await seedTask('sweep-many-offers', { expiresAt: daysAgo(1) });
    const batch = db.batch();
    for (let i = 0; i < 401; i++) {
      const ref = db.collection('taskOffers').doc(`sweep-many-offers_o${i}`);
      batch.set(ref, {
        offerId: ref.id, taskId: 'sweep-many-offers', doerUserId: `d${i}`,
        familyId: 'sweep-family', status: 'withdrawn',
        createdAt: daysAgo(5), updatedAt: daysAgo(5),
      });
    }
    await batch.commit();

    const stats = await runDoSweepTasks(getDb(), getBucket(), new Date());
    expect(stats.expiredTasksDeleted).toBe(1);
    expect(stats.offersDeleted).toBe(401);
    expect(stats.taskCascadeErrors).toBe(0);
    expect(await taskExists('sweep-many-offers')).toBe(false);
    const remaining = await db.collection('taskOffers')
      .where('taskId', '==', 'sweep-many-offers').get();
    expect(remaining.size).toBe(0);
  });

  it('the orphan pass persists its cursor wiring: an exhausted walk clears cronState/doPhotoOrphanSweep', async () => {
    const bucket = getBucket('do-sweep-side-bucket');
    // Seed a truncation cursor as a prior run would have left it; a full
    // walk (tiny prefix — exhausted within the ceiling) must clear it so
    // the next run starts from the head.
    await getDb().collection('cronState').doc('doPhotoOrphanSweep').set({ startOffset: 'do-photos/aaa/zzz' });
    await runDoSweepTasks(getDb(), bucket, new Date());
    const cursor = (await getDb().collection('cronState').doc('doPhotoOrphanSweep').get()).data();
    expect(cursor?.startOffset).toBeNull();
  });

  it('deletes cancelled tasks older than 30 days, keeps younger ones', async () => {
    await seedTask('sweep-cancelled-old', {
      status: 'cancelled', cancelledAt: daysAgo(31), cancelledBy: 'family',
    });
    await seedTask('sweep-cancelled-young', {
      status: 'cancelled', cancelledAt: daysAgo(29), cancelledBy: 'doer',
    });
    const stats = await runDoSweepTasks(getDb(), getBucket(), new Date());
    expect(stats.cancelledTasksDeleted).toBe(1);
    expect(await taskExists('sweep-cancelled-old')).toBe(false);
    expect(await taskExists('sweep-cancelled-young')).toBe(true);
  });

  it('deletes completed tasks older than 180 days and LEAVES younger ones (decision 19)', async () => {
    await seedTask('sweep-completed-old', {
      status: 'completed', completedAt: daysAgo(181),
    });
    await seedTask('sweep-completed-young', {
      status: 'completed', completedAt: daysAgo(179),
    });
    // The accepted offer (with a hypothetical +1 helper) leaves with it —
    // §11.4: the helper's data is bounded by this exact deletion.
    await seedOffer('sweep-completed-old_ow', 'sweep-completed-old', 'accepted');
    const stats = await runDoSweepTasks(getDb(), getBucket(), new Date());
    expect(stats.completedTasksDeleted).toBe(1);
    expect(await taskExists('sweep-completed-old')).toBe(false);
    expect(await taskExists('sweep-completed-young')).toBe(true);
    expect((await getDb().collection('taskOffers').doc('sweep-completed-old_ow').get()).exists).toBe(false);
  });

  it('auto-completes assigned tasks whose doerMarkedDoneAt is older than 7 days (§6.5)', async () => {
    await seedTask('sweep-done-stale', {
      status: 'assigned', assignedUserId: 'doer-x', doerMarkedDoneAt: daysAgo(8),
      expiresAt: daysAgo(5), // irrelevant to assigned tasks — must NOT delete
    });
    await seedTask('sweep-done-fresh', {
      status: 'assigned', assignedUserId: 'doer-y', doerMarkedDoneAt: daysAgo(6),
    });
    await seedTask('sweep-done-unmarked', {
      status: 'assigned', assignedUserId: 'doer-z', doerMarkedDoneAt: null,
    });
    const stats = await runDoSweepTasks(getDb(), getBucket(), new Date());
    expect(stats.tasksAutoCompleted).toBe(1);
    const stale = (await getDb().collection('doTasks').doc('sweep-done-stale').get()).data()!;
    expect(stale.status).toBe('completed');
    expect(stale.completedAt).not.toBeNull();
    expect((await getDb().collection('doTasks').doc('sweep-done-fresh').get()).data()!.status).toBe('assigned');
    expect((await getDb().collection('doTasks').doc('sweep-done-unmarked').get()).data()!.status).toBe('assigned');
  });

  it('an auto-completed task is NOT deleted by the 180d sweep until 180d later (completedAt = sweep time)', async () => {
    await seedTask('sweep-done-then-retained', {
      status: 'assigned', assignedUserId: 'doer-x', doerMarkedDoneAt: daysAgo(200),
    });
    const stats = await runDoSweepTasks(getDb(), getBucket(), new Date());
    expect(stats.tasksAutoCompleted).toBe(1);
    expect(stats.completedTasksDeleted).toBe(0);
    expect((await getDb().collection('doTasks').doc('sweep-done-then-retained').get()).data()!.status).toBe('completed');
  });

  it('deletes unclaimed quarantine objects and unreferenced do-photos objects past the 1-day window (§7.4)', async () => {
    // A SIDE bucket: in the emulator the doStripTaskPhoto trigger consumes
    // every default-bucket quarantine object within seconds (that is its
    // job), so unclaimed residue — in production, stripper-outage leftovers
    // — can only be modelled on a bucket the trigger does not watch. The
    // runner takes the bucket handle injected, so the sweep under test is
    // the real code path. The emulator stamps timeCreated = now, so AGE is
    // driven by passing a FUTURE `now` (the runner takes `now` for exactly
    // this determinism — no fake timers needed).
    const bucket = getBucket('do-sweep-side-bucket');
    await bucket.file('do-uploads/sweep-u2/unclaimed').save(Buffer.from([1]), {
      resumable: false, metadata: { contentType: 'image/jpeg' },
    });
    await bucket.file('do-photos/sweep-u3/orphan').save(Buffer.from([2]), {
      resumable: false, metadata: { contentType: 'image/jpeg' },
    });
    await bucket.file('do-photos/sweep-u3/referenced').save(Buffer.from([3]), {
      resumable: false, metadata: { contentType: 'image/jpeg' },
    });
    await seedTask('sweep-photo-holder', {
      status: 'open', expiresAt: daysFromNow(30),
      photos: [{ uid: 'sweep-u3', photoId: 'referenced' }],
    });

    // Run "two days later": everything above is now >1 day old.
    const stats = await runDoSweepTasks(getDb(), bucket, daysFromNow(2));

    expect(stats.quarantineObjectsDeleted).toBe(1);
    expect((await bucket.file('do-uploads/sweep-u2/unclaimed').exists())[0]).toBe(false);
    expect(stats.orphanPhotoObjectsDeleted).toBe(1);
    expect((await bucket.file('do-photos/sweep-u3/orphan').exists())[0]).toBe(false);
    // Referenced by a live task → kept, however old.
    expect((await bucket.file('do-photos/sweep-u3/referenced').exists())[0]).toBe(true);
  });

  it('fresh quarantine and do-photos objects are NOT swept (the 1-day window)', async () => {
    const bucket = getBucket('do-sweep-side-bucket');
    await bucket.file('do-uploads/sweep-u4/fresh').save(Buffer.from([5]), {
      resumable: false, metadata: { contentType: 'image/jpeg' },
    });
    await bucket.file('do-photos/sweep-u4/fresh-orphan').save(Buffer.from([4]), {
      resumable: false, metadata: { contentType: 'image/jpeg' },
    });
    const stats = await runDoSweepTasks(getDb(), bucket, new Date());
    expect(stats.quarantineObjectsDeleted).toBe(0);
    expect(stats.orphanPhotoObjectsDeleted).toBe(0);
    expect((await bucket.file('do-uploads/sweep-u4/fresh').exists())[0]).toBe(true);
    expect((await bucket.file('do-photos/sweep-u4/fresh-orphan').exists())[0]).toBe(true);
  });
});
