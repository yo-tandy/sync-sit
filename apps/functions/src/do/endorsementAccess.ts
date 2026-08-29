import { HttpsError } from 'firebase-functions/v2/https';
import type { TaskDoc } from '@ejm/do-core';
import { db } from '../config/firebase.js';

/**
 * Shared plumbing for the sync-do endorsement callables (plan decision 12,
 * §9.1/§9.2). Same charter as taskAccess.ts / offerAccess.ts: everything
 * here touches firebase-admin, so it stays out of do-core.
 */

/** The shared collection all three apps' endorsements live in. */
export const REFERENCES = 'references';

/**
 * Charset-bound a caller-supplied id BEFORE it reaches `.doc()` or a
 * `where()` — the `validTaskId` rationale: the Admin SDK treats `/` in a
 * document path as a segment separator, so a slashed id either throws
 * synchronously (surfacing as `internal` instead of `invalid-argument`) or
 * addresses a doc in an arbitrary subcollection.
 */
export function validEndorsementId(referenceId: unknown): string {
  if (
    typeof referenceId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(referenceId)
  ) {
    throw new HttpsError('invalid-argument', 'referenceId is required');
  }
  return referenceId;
}

/** The same bound for a uid arriving as input (`doerUserId`). */
export function validDoerUserId(doerUserId: unknown): string {
  if (
    typeof doerUserId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(doerUserId)
  ) {
    throw new HttpsError('invalid-argument', 'doerUserId is required');
  }
  return doerUserId;
}

/**
 * The §9.1 eligibility gate, and the whole relationship model for a doer
 * endorsement: the caller's family must own a task that is `completed` AND
 * was assigned to this doer.
 *
 * Why a completed task rather than study's `approvedFamilies` membership:
 * study's gate is "we have an accepted contact request", which is the
 * furthest study's data model goes — sync-do has the stronger fact
 * available, because an assignment IS an accepted offer and completion is
 * recorded on the task (§6.5). Decision 12's wording is exactly this:
 * "families endorse a doer after a completed task".
 *
 * Query shape: three EQUALITY filters, no orderBy — Firestore serves
 * equality-only queries by merging single-field indexes, so this needs no
 * composite (the same reason study's dedup query needs none). Recency is
 * picked in memory below rather than with an `orderBy` that would demand
 * one, and the set is small by construction (the tasks one family completed
 * with one student).
 *
 * Returns the most recently completed qualifying task, whose `category`
 * the endorsement copies — server-derived, never client input.
 */
export async function findQualifyingCompletedTask(
  familyId: string,
  doerUserId: string,
): Promise<TaskDoc | null> {
  const snap = await db
    .collection('doTasks')
    .where('familyId', '==', familyId)
    .where('assignedUserId', '==', doerUserId)
    .where('status', '==', 'completed')
    .get();
  if (snap.empty) return null;
  let best: TaskDoc | null = null;
  let bestMs = -1;
  for (const doc of snap.docs) {
    const task = doc.data() as TaskDoc;
    const ms = toMillis(task.completedAt);
    if (ms >= bestMs) {
      bestMs = ms;
      best = task;
    }
  }
  return best;
}

/** Firestore Timestamp | Date → epoch ms (0 when absent/unreadable). */
function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const asTs = value as { toMillis?: () => number } | null | undefined;
  if (asTs && typeof asTs.toMillis === 'function') return asTs.toMillis();
  return 0;
}
