import type { Firestore } from 'firebase-admin/firestore';
import {
  DO_CANCELLED_RETENTION_DAYS,
  DO_COMPLETED_RETENTION_DAYS,
  DO_DONE_AUTOCOMPLETE_DAYS,
  type TaskDoc,
} from '@ejm/do-core';
import {
  deleteTaskCascade,
  DO_PHOTOS_PREFIX,
  type TaskCascadeStats,
  DO_UPLOADS_PREFIX,
  type StorageBucket,
} from './taskAccess.js';

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
  /** Cascades that failed and were skipped (poison-pill isolation). */
  taskCascadeErrors: number;
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
    taskCascadeErrors: 0,
  };

  /**
   * Delete one task with its offers and photo objects (§11.4's cascade).
   * The body lives in `taskAccess.deleteTaskCascade` because PR10's
   * `doAdminDeleteTask` performs the identical cascade — an admin delete
   * that left `taskOffers` rows and `do-photos` objects behind would create
   * exactly the orphans §11.4 exists to prevent. This wrapper only folds the
   * returned counts into the sweep's stats.
   *
   * The accumulator is passed IN and folded in a `finally`, not read from
   * the return value: a cascade that throws partway (a persistent 5xx on an
   * object delete) still deleted offers, and the caller's poison-pill catch
   * below is exactly the path whose numbers must not understate what
   * happened. Returning-only would report 0 for a pass that really removed
   * documents — the inline accounting this was extracted from got that
   * right, and losing it was the extraction's one behavioural change.
   */
  async function cascade(
    taskRef: FirebaseFirestore.DocumentReference,
    task: TaskDoc,
  ): Promise<void> {
    const result: TaskCascadeStats = { offersDeleted: 0, photoObjectsDeleted: 0 };
    try {
      await deleteTaskCascade(db, bucket, taskRef, task, result);
    } finally {
      stats.offersDeleted += result.offersDeleted;
      stats.taskPhotoObjectsDeleted += result.photoObjectsDeleted;
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
      // Per-task error isolation: one poisoned cascade (a persistent 5xx on
      // an object delete, say) must log-and-continue, not kill the rest of
      // this category, the remaining categories and both storage passes —
      // a deterministic per-doc failure would otherwise wedge the sweep at
      // the same document every day, forever.
      let deleted = 0;
      for (const doc of snap.docs) {
        try {
          await cascade(doc.ref, doc.data() as TaskDoc);
          deleted += 1;
        } catch (err) {
          stats.taskCascadeErrors += 1;
          console.error(`doSweepTasks: cascade failed for ${doc.ref.id}:`, err);
        }
      }
      stats[sweep.statKey] += deleted;
      console.log(`doSweepTasks: deleted ${deleted} ${sweep.label} tasks`);
      if (snap.size < SWEEP_PAGE) break;
      // Every doc in a full page failed: re-querying returns the same page,
      // so further passes only repeat the failures — stop this category.
      if (deleted === 0) break;
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
  // 540s-bounded schedule the walk must be bounded per run.
  type StorageFile = ReturnType<StorageBucket['file']>;
  interface ListPageResult {
    /** Name of the last file examined (the resume point), or null. */
    lastName: string | null;
    /** True when the walk reached the end of the prefix within the ceiling. */
    exhausted: boolean;
  }
  const listPages = async (
    prefix: string,
    startOffset: string | undefined,
    onFile: (file: StorageFile) => Promise<void>,
  ): Promise<ListPageResult> => {
    let pageToken: string | undefined;
    let lastName: string | null = null;
    for (let pass = 0; pass < SWEEP_MAX_PASSES; pass++) {
      // getFiles' manual paging: autoPaginate off, explicit token.
      // startOffset (lexicographic, inclusive) applies to the first page
      // only — subsequent pages continue from the token.
      const [files, nextQuery] = (await bucket.getFiles({
        prefix,
        maxResults: 1000,
        autoPaginate: false,
        ...(pageToken ? { pageToken } : startOffset ? { startOffset } : {}),
      })) as unknown as [StorageFile[], { pageToken?: string } | null];
      for (const file of files) {
        await onFile(file);
        lastName = file.name;
      }
      pageToken = nextQuery?.pageToken;
      if (!pageToken) return { lastName, exhausted: true };
    }
    return { lastName, exhausted: false };
  };

  // Quarantine originals the stripper never claimed (its fail-closed path
  // deletes hostile objects immediately; anything left is stripper outage
  // residue or abandonment). No cursor needed: every stale object is
  // deleted and fresh ones age in behind it, so THIS prefix genuinely
  // drains across runs from a head start.
  await listPages(DO_UPLOADS_PREFIX, undefined, async (file) => {
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
  //
  // Unlike the quarantine pass, this walk does NOT drain from a head start:
  // REFERENCED objects are kept, permanently occupying the front of the
  // lexicographic listing, so a head-restarting capped walk would stop
  // examining anything past the ceiling once the prefix outgrows it —
  // orphans in the tail would be retained forever, silently voiding the
  // §11.4 guarantee. The cursor (cronState/doPhotoOrphanSweep, the
  // appointment-note-redaction precedent) makes successive runs ADVANCE
  // through the prefix: a truncated run stores where it stopped and the
  // next resumes there (startOffset is inclusive, so re-examining the
  // boundary object is idempotent); an exhausted walk clears the cursor and
  // the next run starts from the head.
  const orphanCursorRef = db.collection('cronState').doc('doPhotoOrphanSweep');
  const storedCursor = (await orphanCursorRef.get()).data()?.startOffset;
  const orphanWalk = await listPages(
    DO_PHOTOS_PREFIX,
    typeof storedCursor === 'string' ? storedCursor : undefined,
    async (file) => {
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
    },
  );
  await orphanCursorRef.set(
    { startOffset: orphanWalk.exhausted ? null : orphanWalk.lastName },
    { merge: true },
  );

  console.log(
    `doSweepTasks complete: ${JSON.stringify(stats)}`,
  );
  return stats;
}
