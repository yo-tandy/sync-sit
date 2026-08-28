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
 *
 * KNOWN RETENTION GAP, stated so the §11.4 bound is not overstated: an
 * `assigned` task abandoned by BOTH sides — the doer never marks done, the
 * family never confirms, neither cancels — matches no half above, so it
 * (and its accepted offer, +1 helper included) is retained until someone
 * acts. The plan's sweep rows (§8) name no assigned-staleness ceiling and
 * inventing one is a policy call (auto-complete vs auto-cancel changes the
 * §9.1 history and the PR11 endorsement prompt), so it is deferred to the
 * owner — flagged in PR5's review; PR10's admin task view makes such tasks
 * visible in the meantime.
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
    // Task doc BEFORE its photo objects, so the reference check below never
    // counts the task being deleted.
    await taskRef.delete();
    // Photo objects: the stored pair IS the object path — but NOT
    // unconditionally: nothing dedupes pairs across tasks (both write paths
    // accept the same own-prefix pair on two tasks), so deleting blindly
    // would 404 a still-open sibling task's photo with no way to re-attach
    // (only the stripper writes the final prefix). Same exact-map
    // array-contains check the orphan sweep uses; a pair another task still
    // references is left for the orphan pass to collect once the LAST
    // referencing task is gone. ignoreNotFound — a re-run after a partial
    // failure must not throw on the half that already succeeded.
    for (const pair of task.photos ?? []) {
      const stillReferenced = await db
        .collection('doTasks')
        .where('photos', 'array-contains', { uid: pair.uid, photoId: pair.photoId })
        .limit(1)
        .get();
      if (!stillReferenced.empty) continue;
      await bucket
        .file(photoObjectPath(pair.uid, pair.photoId))
        .delete({ ignoreNotFound: true });
      stats.taskPhotoObjectsDeleted += 1;
    }
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

  // Both listings are PAGED with a pass ceiling, mirroring the Firestore
  // sweeps: an autopaginated getFiles() pulls every object's metadata into
  // memory and its runtime scales with the whole prefix — on a shared
  // 540s-bounded schedule the walk must be bounded per run, with the
  // remainder picked up tomorrow (deletions shrink the prefix, so the
  // backlog drains across runs by construction).
  type StorageFile = ReturnType<StorageBucket['file']>;
  const listPages = async (
    prefix: string,
    onFile: (file: StorageFile) => Promise<void>,
  ): Promise<void> => {
    let pageToken: string | undefined;
    for (let pass = 0; pass < SWEEP_MAX_PASSES; pass++) {
      // getFiles' manual paging: autoPaginate off, explicit token.
      const [files, nextQuery] = (await bucket.getFiles({
        prefix,
        maxResults: 1000,
        autoPaginate: false,
        pageToken,
      })) as unknown as [StorageFile[], { pageToken?: string } | null];
      for (const file of files) {
        await onFile(file);
      }
      pageToken = nextQuery?.pageToken;
      if (!pageToken) break;
    }
  };

  // Quarantine originals the stripper never claimed (its fail-closed path
  // deletes hostile objects immediately; anything left is stripper outage
  // residue or abandonment).
  await listPages(DO_UPLOADS_PREFIX, async (file) => {
    if (isStale(file.metadata.timeCreated as string | undefined)) {
      await file.delete({ ignoreNotFound: true });
      stats.quarantineObjectsDeleted += 1;
    }
  });

  // Final objects no task references — uploaded, stripped, but never
  // attached (abandoned wizard), or left dangling by a partial cascade.
  // Exact-map array-contains matches the stored {uid, photoId} pair —
  // NOTE: if TaskDoc's photo entries ever gain a third field, this exact
  // match (and deleteTaskCascade's) silently stops matching; keep the
  // stored pair shape and these queries in lockstep.
  await listPages(DO_PHOTOS_PREFIX, async (file) => {
    if (!isStale(file.metadata.timeCreated as string | undefined)) return;
    const parts = file.name.split('/');
    if (parts.length !== 3) return;
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
  });

  console.log(
    `doSweepTasks complete: ${JSON.stringify(stats)}`,
  );
  return stats;
}
