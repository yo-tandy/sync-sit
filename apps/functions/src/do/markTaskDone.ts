import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { TaskDoc } from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { callerFamilyId, validTaskId } from './taskAccess.js';
import {
  notifyDoFamilyParents,
  notifyDoSafely,
  sendDoNotificationToUser,
} from './notify.js';
import {
  buildTaskCompletedForDoer,
  buildTaskMarkedDoneForFamily,
} from './notifyContent.js';

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
    const ref = db.collection('doTasks').doc(validTaskId(data.taskId));
    const now = new Date();

    const callerDoc = await db.collection('users').doc(uid).get();
    const callerData = (callerDoc.data() ?? {}) as Record<string, unknown>;
    if ((callerData.status as string | undefined) !== 'active') {
      throw new HttpsError('permission-denied', 'Account is not active');
    }
    const familyId = callerFamilyId(callerData);

    let result: 'completed' | 'marked' = 'marked';
    let taskFamilyId = '';
    let taskTitle = '';
    let familyName = '';
    let assignedUserId: string | null = null;
    let firstMark = false;
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
        firstMark = task.doerMarkedDoneAt === null;
        if (firstMark) {
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
      taskTitle = task.title;
      familyName = task.familyName;
      assignedUserId = task.assignedUserId;
    });

    // The student's FIRST mark notifies the family (an idempotent re-mark
    // must not re-notify); the family's completion notifies the student
    // (plan §10, §13 PR9) — post-commit, failures swallowed.
    await notifyDoSafely('markTaskDone', async () => {
      if (result === 'marked' && firstMark) {
        const doerFirstName =
          (callerData.firstName as string | undefined) || 'The student';
        await notifyDoFamilyParents(taskFamilyId, {
          type: 'task_marked_done',
          prefCategory: 'confirmed',
          content: (lang) =>
            buildTaskMarkedDoneForFamily(lang, {
              doerFirstName,
              taskTitle,
              taskId: ref.id,
            }),
          data: { taskId: ref.id },
        });
      } else if (result === 'completed' && assignedUserId) {
        await sendDoNotificationToUser({
          recipientUserId: assignedUserId,
          type: 'task_marked_done',
          prefCategory: 'confirmed',
          content: (lang) =>
            buildTaskCompletedForDoer(lang, { familyName, taskTitle }),
          data: { taskId: ref.id },
        });
      }
    });

    await writeUserActivity(uid, 'do.task_marked_done', {
      taskId: ref.id,
      familyId: taskFamilyId,
      result,
    });

    return { taskId: ref.id, result };
  },
);
