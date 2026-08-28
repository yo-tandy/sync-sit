import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { TaskDoc } from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { callerFamilyId } from './taskAccess.js';

/**
 * `doCancelTask` (plan §8, §6.5): task → `cancelled`.
 *
 * Who may cancel, per the §8 row exactly:
 * - an OPEN task: the owner family only;
 * - an ASSIGNED task: the owner family or the assigned doer (§6.5 — either
 *   side may cancel, `cancelledBy` records who; no penalty, no policy
 *   engine — decision 8 means there is no money to claw back).
 *
 * Every live offer (`pending` / `pending_guardian`) sweeps to `expired` —
 * the status the family's §7.2 allow-list already excludes, and the
 * truthful description: the task went away underneath the offer — and
 * `offerCount` lands at 0 in the same transaction (§4.1's invariant: the
 * count decrements whenever an offer leaves the live set by ANY path).
 * Offers land at PR6, but the sweep is generic against `taskOffers` so any
 * that exist are handled. On an assigned task there are normally no live
 * offers left (the acceptance flip cleared them); the ACCEPTED offer keeps
 * `accepted` — it is the record of who was engaged at what price, carries
 * no contact data (decision 16), and the 30-day cancelled-task sweep bounds
 * its retention.
 */
export const doCancelTask = onCall(
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

    let cancelledBy: 'family' | 'doer' = 'family';
    let taskFamilyId = '';
    await db.runTransaction(async (tx) => {
      // Reads first, then writes (Firestore transactions throw on a read
      // after any write — the §6.4 phase rule applies here too).
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Task not found');
      }
      const task = snap.data() as TaskDoc;
      taskFamilyId = task.familyId;

      const isOwnerFamily = familyId !== null && familyId === task.familyId;
      const isAssignedDoer =
        task.assignedUserId !== null && uid === task.assignedUserId;
      if (task.status === 'open') {
        if (!isOwnerFamily) {
          throw new HttpsError(
            'permission-denied',
            'Only the owner family can cancel an open task',
          );
        }
        cancelledBy = 'family';
      } else if (task.status === 'assigned') {
        if (isOwnerFamily) {
          cancelledBy = 'family';
        } else if (isAssignedDoer) {
          cancelledBy = 'doer';
        } else {
          throw new HttpsError(
            'permission-denied',
            'Only the owner family or the assigned doer can cancel this task',
          );
        }
      } else {
        throw new HttpsError(
          'failed-precondition',
          `A ${task.status} task cannot be cancelled`,
          { reason: 'not_cancellable' },
        );
      }

      const liveOffers = await tx.get(
        db
          .collection('taskOffers')
          .where('taskId', '==', ref.id)
          .where('status', 'in', ['pending', 'pending_guardian']),
      );

      tx.update(ref, {
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy,
        offerCount: 0,
        updatedAt: now,
      });
      for (const offer of liveOffers.docs) {
        tx.update(offer.ref, { status: 'expired', updatedAt: now });
      }
    });

    // PR9: notify the counterparty (and any swept offerers) — no
    // notification plumbing in PR5.

    await writeUserActivity(uid, 'do.task_cancelled', {
      taskId: ref.id,
      familyId: taskFamilyId,
      cancelledBy,
    });

    return { taskId: ref.id, cancelledBy };
  },
);
