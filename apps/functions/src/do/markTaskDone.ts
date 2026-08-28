import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { TaskDoc } from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { callerFamilyId } from './taskAccess.js';

/**
 * `doMarkTaskDone` (plan §8, §6.5): either side marks an ASSIGNED task done.
 *
 * - The assigned STUDENT'S mark sets `doerMarkedDoneAt` — the task stays
 *   `assigned`; a task the family never confirms auto-completes 7 days
 *   later via the daily sweep (§6.5, the (status, doerMarkedDoneAt) index).
 *   Re-marking is an idempotent no-op (the first timestamp is what the
 *   sweep's 7-day clock runs from).
 * - The FAMILY'S mark completes: `status → completed`, `completedAt` set —
 *   whether or not the student marked first.
 */
export const doMarkTaskDone = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as Record<string, unknown>;
    if (typeof data.taskId !== 'string' || data.taskId.length === 0) {
      throw new HttpsError('invalid-argument', 'taskId is required');
    }
    const ref = db.collection('doTasks').doc(data.taskId);
    const now = new Date();

    const callerDoc = await db.collection('users').doc(uid).get();
    const callerData = (callerDoc.data() ?? {}) as Record<string, unknown>;
    if ((callerData.status as string | undefined) !== 'active') {
      throw new HttpsError('permission-denied', 'Account is not active');
    }
    const familyId = callerFamilyId(callerData);

    let result: 'completed' | 'marked' = 'marked';
    let taskFamilyId = '';
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Task not found');
      }
      const task = snap.data() as TaskDoc;
      taskFamilyId = task.familyId;
      if (task.status !== 'assigned') {
        throw new HttpsError(
          'failed-precondition',
          'Only an assigned task can be marked done',
          { reason: 'not_assigned' },
        );
      }
      const isOwnerFamily = familyId !== null && familyId === task.familyId;
      const isAssignedDoer =
        task.assignedUserId !== null && uid === task.assignedUserId;
      if (isOwnerFamily) {
        result = 'completed';
        tx.update(ref, {
          status: 'completed',
          completedAt: now,
          updatedAt: now,
        });
      } else if (isAssignedDoer) {
        result = 'marked';
        if (task.doerMarkedDoneAt === null) {
          tx.update(ref, { doerMarkedDoneAt: now, updatedAt: now });
        }
        // Already marked: idempotent no-op — retries must not error, and the
        // sweep's 7-day auto-complete clock keeps its original start.
      } else {
        throw new HttpsError(
          'permission-denied',
          'Only the owner family or the assigned doer can mark this task done',
        );
      }
    });

    // PR9: the student's mark notifies the family; completion notifies the
    // student. No notification plumbing in PR5.

    await writeUserActivity(uid, 'do.task_marked_done', {
      taskId: ref.id,
      familyId: taskFamilyId,
      result,
    });

    return { taskId: ref.id, result };
  },
);
