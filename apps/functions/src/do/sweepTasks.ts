import type { Firestore } from 'firebase-admin/firestore';
import type { getStorage } from 'firebase-admin/storage';
import {
  DO_CANCELLED_RETENTION_DAYS,
  DO_COMPLETED_RETENTION_DAYS,
  DO_DONE_AUTOCOMPLETE_DAYS,
  type TaskDoc,
} from '@ejm/do-core';
import { photoObjectPath, DO_PHOTOS_PREFIX, DO_UPLOADS_PREFIX } from './taskAccess.js';

/** Structural bucket type — avoids a direct @google-cloud/storage import
 *  (transitive dep; firebase-admin/storage re-exports the instance type). */
type StorageBucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Unclaimed-photo window (§7.4): a quarantine object the stripper never
 * consumed, and a `do-photos` object no task references, are swept once
 * older than this. One day — the wizard uploads and publishes in a single
 * session, and the stripper claims quarantine objects within seconds, so
 * anything older is abandonment or attack residue. Server-only constant:
 * nothing in the UI shares this number, so it stays out of do-core.
 */
const DO_PHOTO_UNCLAIMED_DAYS = 1;

/** Per-query page size; each category drains with a bounded pass loop. */
const SWEEP_PAGE = 200;
const SWEEP_MAX_PASSES = 10;

export interface DoSweepStats {
  expiredTasksDeleted: number;
  cancelledTasksDeleted: number;
  completedTasksDeleted: number;
  offersDeleted: number;
  tasksAutoCompleted: number;
  taskPhotoObjectsDeleted: number;
  quarantineObjectsDeleted: number;
  orphanPhotoObjectsDeleted: number;
}

/**
 * The sync-do daily sweep (plan §8's `doSweepTasks` row, §6.3, §6.5,
 * §11.4). Runs on the EXISTING `cleanupOldData` schedule (§8: extend the
 * schedule rather than adding a second job); extracted for testability like
 * `runCleanupOldData`.
 *
 * 1. Delete expired OPEN tasks and their offers — §6.3's board bound.
 * 2. Delete CANCELLED tasks (and offers) older than 30 days — the same
 *    window `cleanupOldData` applies to cancelled/rejected appointments.
 * 3. Delete COMPLETED tasks (and offers) older than 180 days — decision
 *    19's 6-month retention. This is also the +1 helper's data-retention
 *    bound: the helper's name and age on the accepted offer belong to the
 *    one data subject with no GDPR path of their own (§11.4).
 * 4. Auto-complete ASSIGNED tasks whose `doerMarkedDoneAt` is older than 7
 *    days — the family never confirmed, the student's mark stands (§6.5).
 * 5. Whenever a task is deleted (paths 1–3), delete the `do-photos` objects
 *    its `photos[]` references — each entry carries `{uid, photoId}`, which
 *    IS the object path, so the documents and the images leave together
 *    (§11.4).
 * 6. Delete unclaimed `do-uploads` quarantine objects, and `do-photos`
 *    objects no task references, past the 1-day window (§7.4).
 */
export async function runDoSweepTasks(
  db: Firestore,
  bucket: StorageBucket,
  now: Date,
): Promise<DoSweepStats> {
  const stats: DoSweepStats = {
    expiredTasksDeleted: 0,
    cancelledTasksDeleted: 0,
    completedTasksDeleted: 0,
    offersDeleted: 0,
    tasksAutoCompleted: 0,
    taskPhotoObjectsDeleted: 0,
    quarantineObjectsDeleted: 0,
    orphanPhotoObjectsDeleted: 0,
  };

  /** Delete one task with its offers and photo objects (§11.4's cascade). */
  async function deleteTaskCascade(
    taskRef: FirebaseFirestore.DocumentReference,
    task: TaskDoc,
  ): Promise<void> {
    // Offers first: every offer on the task, regardless of status — the
    // task is the reason the offer exists, and admin inspection of a
    // deleted task's offers is not a supported surface (§11.4 retention).
    const offers = await db
      .collection('taskOffers')
      .where('taskId', '==', taskRef.id)
      .get();
    if (!offers.empty) {
      const batch = db.batch();
      for (const offer of offers.docs) {
        batch.delete(offer.ref);
      }
      await batch.commit();
      stats.offersDeleted += offers.size;
    }
    // Photo objects: the stored pair IS the object path. ignoreNotFound —
    // a re-run after a partial failure must not throw on the half that
    // already succeeded.
    for (const pair of task.photos ?? []) {
      await bucket
        .file(photoObjectPath(pair.uid, pair.photoId))
        .delete({ ignoreNotFound: true });
      stats.taskPhotoObjectsDeleted += 1;
    }
    await taskRef.delete();
  }

  // ── 1–3: the three deletion queries, each drained with a bounded pass
  // loop (the cleanupOldData house style). Composite indexes from PR3:
  // (status, expiresAt), (status, cancelledAt), (status, completedAt). ──
  const deletionSweeps: {
    statKey: 'expiredTasksDeleted' | 'cancelledTasksDeleted' | 'completedTasksDeleted';
    status: string;
    field: 'expiresAt' | 'cancelledAt' | 'completedAt';
    cutoff: Date;
    label: string;
  }[] = [
    {
      statKey: 'expiredTasksDeleted',
      status: 'open',
      field: 'expiresAt',
      cutoff: now,
      label: 'expired open',
    },
    {
      statKey: 'cancelledTasksDeleted',
      status: 'cancelled',
      field: 'cancelledAt',
      cutoff: new Date(now.getTime() - DO_CANCELLED_RETENTION_DAYS * DAY_MS),
      label: `cancelled >${DO_CANCELLED_RETENTION_DAYS}d`,
    },
    {
      statKey: 'completedTasksDeleted',
      status: 'completed',
      field: 'completedAt',
      cutoff: new Date(now.getTime() - DO_COMPLETED_RETENTION_DAYS * DAY_MS),
      label: `completed >${DO_COMPLETED_RETENTION_DAYS}d (decision 19)`,
    },
  ];
  for (const sweep of deletionSweeps) {
    for (let pass = 0; pass < SWEEP_MAX_PASSES; pass++) {
      const snap = await db
        .collection('doTasks')
        .where('status', '==', sweep.status)
        .where(sweep.field, '<', sweep.cutoff)
        .limit(SWEEP_PAGE)
        .get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        await deleteTaskCascade(doc.ref, doc.data() as TaskDoc);
      }
      stats[sweep.statKey] += snap.size;
      console.log(`doSweepTasks: deleted ${snap.size} ${sweep.label} tasks`);
      if (snap.size < SWEEP_PAGE) break;
    }
  }

  // ── 4: auto-complete stale doer-marked tasks (§6.5) ──
  const doneCutoff = new Date(now.getTime() - DO_DONE_AUTOCOMPLETE_DAYS * DAY_MS);
  for (let pass = 0; pass < SWEEP_MAX_PASSES; pass++) {
    const snap = await db
      .collection('doTasks')
      .where('status', '==', 'assigned')
      .where('doerMarkedDoneAt', '<', doneCutoff)
      .limit(SWEEP_PAGE)
      .get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      });
    }
    await batch.commit();
    stats.tasksAutoCompleted += snap.size;
    console.log(
      `doSweepTasks: auto-completed ${snap.size} tasks the family never confirmed`,
    );
    if (snap.size < SWEEP_PAGE) break;
  }

  // ── 5–6: unclaimed storage objects (§7.4). timeCreated is server-set
  // object metadata — a client cannot forge freshness. ──
  const unclaimedCutoffMs = now.getTime() - DO_PHOTO_UNCLAIMED_DAYS * DAY_MS;
  const isStale = (timeCreated: string | undefined): boolean => {
    const created = timeCreated ? Date.parse(timeCreated) : NaN;
    // Unparseable metadata fails SAFE (kept): deleting on bad data risks a
    // live task's photo; the object then ages out of a later run if a
    // future pass can read it.
    return Number.isFinite(created) && created < unclaimedCutoffMs;
  };

  // Quarantine originals the stripper never claimed (its fail-closed path
  // deletes hostile objects immediately; anything left is stripper outage
  // residue or abandonment).
  const [quarantineFiles] = await bucket.getFiles({ prefix: DO_UPLOADS_PREFIX });
  for (const file of quarantineFiles) {
    if (isStale(file.metadata.timeCreated as string | undefined)) {
      await file.delete({ ignoreNotFound: true });
      stats.quarantineObjectsDeleted += 1;
    }
  }

  // Final objects no task references — uploaded, stripped, but never
  // attached (abandoned wizard), or left dangling by a partial cascade.
  // Exact-map array-contains matches the stored {uid, photoId} pair.
  const [finalFiles] = await bucket.getFiles({ prefix: DO_PHOTOS_PREFIX });
  for (const file of finalFiles) {
    if (!isStale(file.metadata.timeCreated as string | undefined)) continue;
    const parts = file.name.split('/');
    if (parts.length !== 3) continue;
    const [, uid, photoId] = parts;
    const referencing = await db
      .collection('doTasks')
      .where('photos', 'array-contains', { uid, photoId })
      .limit(1)
      .get();
    if (referencing.empty) {
      await file.delete({ ignoreNotFound: true });
      stats.orphanPhotoObjectsDeleted += 1;
    }
  }

  console.log(
    `doSweepTasks complete: ${JSON.stringify(stats)}`,
  );
  return stats;
}
