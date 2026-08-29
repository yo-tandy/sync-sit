import type { Firestore } from 'firebase-admin/firestore';
import { COMPLETED_ENGAGEMENT_RETENTION_DAYS } from '@ejm/shared-core';
import type { SessionBlockEntry } from '@ejm/shared-functions/schedule/sessionOverride.js';
import { createClaimReleaser, STUDY_PROVENANCE } from './retentionClaims.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Per-query page size; the category drains with a bounded pass loop. */
const SWEEP_PAGE = 100;
const SWEEP_MAX_PASSES = 10;
/** Firestore's write-batch ceiling. */
const BATCH_LIMIT = 500;

export interface StudySweepStats {
  completedSessionsDeleted: number;
  instancesDeleted: number;
  overrideClaimsReleased: number;
  /** Cascades that failed and were skipped (poison-pill isolation). */
  sessionCascadeErrors: number;
}

/**
 * sync-study's completed-engagement retention sweep — the study half of issue
 * #294 / decision 19 ("there's no reason to retain completed engagement
 * indefinitely — in any of the sync apps. Let's set a retention period of 6
 * months", sync-do plan §2 decision 19, §11.4).
 *
 * Rides the EXISTING `cleanupOldData` schedule exactly as `runDoSweepTasks`
 * does — one daily job, three halves — rather than adding a fourth scheduled
 * function. It lives in this codebase (not `study-functions`) for the same
 * reason: `cleanupOldData` is already the platform's retention job, sweeping
 * cross-app collections (`notifications`, `auditLogs`, `references`-adjacent
 * markers) that study writes to as well.
 *
 * WHAT IT DELETES. `study-sessions` docs with `status === 'completed'` whose
 * `completedAt` is older than 180 days — both shapes:
 *   • a ONE_TIME session (`markSessionsCompleted` (a) flips it once its end
 *     time passes), and
 *   • a RECURRING SERIES parent (`markSessionsCompleted` (c) flips it once its
 *     `endDate` is past AND no `scheduled` instance remains).
 *
 * WHAT CASCADES WITH IT.
 *   1. The `instances` subcollection — every concrete occurrence of the series.
 *      Firestore does not delete subcollections with their parent, so leaving
 *      this out would strand the occurrences as unreachable orphans that the
 *      `instances` COLLECTION_GROUP queries would still return.
 *   2. Session notes. Both the family's `preSessionNote` and the tutor's
 *      `postSessionNote` are FIELDS on the session (one_time) or the instance
 *      (recurring), so they leave with their document — no separate step, and
 *      nothing left behind for a redaction pass to find.
 *   3. The provider's schedule claims: the `sessionBlocks` ledger entries in
 *      `schedules/{tutorUserId}/overrides/{date}`. A recurring occurrence's
 *      entry is normally already gone (the hourly `markSessionsCompleted`
 *      prunes it at completion, `cancelSessionInstance`/`cancelSession` at
 *      cancel, and a `conflict_skip` instance never claimed one) — so this is
 *      belt-and-braces there. For a ONE_TIME session it is load-bearing:
 *      NOTHING prunes its claim today, so deleting the session without this
 *      step leaves a ledger entry naming a document that no longer exists.
 *
 * KNOWN GAP, stated rather than silently widened: study `cancelled` and
 * `declined` sessions have NO retention sweep at all — sit deletes its
 * cancelled/rejected appointments at 30 days, study deletes nothing. That is a
 * separate policy call (which window, and whether a cancelled recurring series
 * keeps its instances) and decision 19 is about COMPLETED engagement, so it is
 * left for the owner rather than invented here.
 */
export async function runStudySweepSessions(
  db: Firestore,
  now: Date,
): Promise<StudySweepStats> {
  const stats: StudySweepStats = {
    completedSessionsDeleted: 0,
    instancesDeleted: 0,
    overrideClaimsReleased: 0,
    sessionCascadeErrors: 0,
  };

  const cutoff = new Date(now.getTime() - COMPLETED_ENGAGEMENT_RETENTION_DAYS * DAY_MS);
  const releaseClaim = createClaimReleaser(db, now);

  /**
   * Delete one completed session with its instances and schedule claims, in
   * three steps: release claims, delete the instances, delete the parent.
   *
   * The PARENT is deleted last, which buys one specific guarantee and not a
   * general one. A failed claim release (step 1) leaves the whole engagement
   * intact — documents and ledger both — so the next run retries it whole,
   * and no override entry is ever left naming a document that has gone. A
   * failure BETWEEN the instance batches and the parent delete (a throw on
   * `doc.ref.delete()`, or the 540s budget expiring in that window) is not
   * covered: it leaves an instance-less parent. That state is benign and
   * self-healing — the next run re-fetches an empty `instances`, releases
   * nothing, and deletes the parent — at the cost of a completed series
   * rendering with zero occurrences for up to a day. Making it atomic would
   * need a transaction spanning an unbounded subcollection, which Firestore
   * will not give us; accepting a self-healing intermediate state is the
   * right trade for a sweep whose documents are already 180 days dead.
   */
  async function cascade(
    doc: FirebaseFirestore.QueryDocumentSnapshot,
  ): Promise<void> {
    const session = doc.data();
    const sessionId = doc.id;
    const tutorUserId = (session.tutorUserId as string) ?? '';

    const instancesSnap = await doc.ref.collection('instances').get();

    // ── 1. Release the schedule claims ──
    if (typeof session.date === 'string' && session.date) {
      // one_time: the claim carries the sessionId and NO instanceId.
      const released = await releaseClaim(
        tutorUserId,
        session.date,
        (b: SessionBlockEntry) => b.sessionId === sessionId && !b.instanceId,
        STUDY_PROVENANCE,
      );
      if (released) stats.overrideClaimsReleased += 1;
    }
    for (const inst of instancesSnap.docs) {
      const date = inst.get('date') as string | undefined;
      if (typeof date !== 'string' || !date) continue;
      const released = await releaseClaim(
        (inst.get('tutorUserId') as string) ?? tutorUserId,
        date,
        (b: SessionBlockEntry) => b.sessionId === sessionId && b.instanceId === inst.id,
        STUDY_PROVENANCE,
      );
      if (released) stats.overrideClaimsReleased += 1;
    }

    // ── 2. Delete the instances (chunked — a long series can exceed 500) ──
    for (let i = 0; i < instancesSnap.docs.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const inst of instancesSnap.docs.slice(i, i + BATCH_LIMIT)) {
        batch.delete(inst.ref);
      }
      await batch.commit();
      stats.instancesDeleted += Math.min(BATCH_LIMIT, instancesSnap.docs.length - i);
    }

    // ── 3. Delete the parent ──
    await doc.ref.delete();
  }

  // Cursor-paginated WITHIN the run, for the same reason the sit half is: a
  // session whose cascade fails deterministically keeps its `completedAt`, so
  // it sorts to the head of `completedAt ASC` and a head-restarting pass loop
  // would re-fetch it — and only it — on every pass. `startAfter(snapshot)`
  // is value-based ((completedAt, __name__)), so it positions correctly past
  // documents the previous page just deleted.
  //
  // ABSENT-vs-NULL AUDIT (the sit half's bug, checked here too): `completedAt`
  // is written in exactly three places, all in `markSessionsCompleted`
  // (:91, :136, :166), always as a real timestamp alongside
  // `status: 'completed'`. No writer stores `completedAt: null`, and no path
  // sets `status: 'completed'` without it — so unlike sit's `date`, this
  // range needs no lower bound to keep non-conforming shapes out of the page.
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (let pass = 0; pass < SWEEP_MAX_PASSES; pass++) {
    // (status, completedAt) composite — added to firestore.indexes.json with
    // this sweep. Without it the query fails FAILED_PRECONDITION inside a
    // scheduled job where nobody is watching.
    let query = db
      .collection('study-sessions')
      .where('status', '==', 'completed')
      .where('completedAt', '<', cutoff)
      .orderBy('completedAt')
      .limit(SWEEP_PAGE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) break;

    // Per-session error isolation (the doSweepTasks / sendTaskDigest pattern):
    // one poisoned cascade must log-and-continue, not abort the category and
    // wedge the sweep at the same document every day forever.
    let deleted = 0;
    for (const doc of snap.docs) {
      try {
        await cascade(doc);
        deleted += 1;
      } catch (err) {
        stats.sessionCascadeErrors += 1;
        console.error(`studySweepSessions: cascade failed for ${doc.id}:`, err);
      }
    }
    stats.completedSessionsDeleted += deleted;
    console.log(
      `studySweepSessions: deleted ${deleted} completed sessions >${COMPLETED_ENGAGEMENT_RETENTION_DAYS}d (decision 19)`,
    );
    if (deleted === 0 && snap.size === SWEEP_PAGE) {
      // A FULL page where nothing succeeded. The cursor still advances past
      // it, so this is not a wedge — but it is indistinguishable from a
      // healthy zero-delete run in the logs unless it says so.
      console.warn(
        'studySweepSessions: a full page of sessions failed to cascade; advancing past it',
      );
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < SWEEP_PAGE) break;
    if (pass === SWEEP_MAX_PASSES - 1) {
      console.warn(
        'studySweepSessions: hit the pass ceiling; the remainder is deferred to the next run',
      );
    }
  }

  if (stats.sessionCascadeErrors > 0) {
    // The caller (the cleanupOldData handler) discards the returned stats, so
    // the counter reaches nobody unless it is logged at a severity that shows.
    console.warn(
      `studySweepSessions: ${stats.sessionCascadeErrors} session cascade(s) failed and were skipped`,
    );
  }
  console.log(`studySweepSessions complete: ${JSON.stringify(stats)}`);
  return stats;
}
