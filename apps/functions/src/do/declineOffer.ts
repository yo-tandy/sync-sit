import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { OfferDoc } from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { callerFamilyId } from './taskAccess.js';
import { loadActiveCaller, validOfferId } from './offerAccess.js';
import { notifyDoSafely, sendDoNotificationSafely } from './notify.js';
import { buildTaskOfferDeclined } from './notifyContent.js';

/**
 * `doDeclineOffer` (plan §8): the owner family declines a single `pending`
 * offer → `declined` / `declinedReason: 'family_declined'`, decrementing the
 * live `offerCount` (§4.1's invariant).
 *
 * `pending` only: a `pending_guardian` offer is invisible to the family
 * (§6.2) and cannot be declined by someone who cannot see it — the refusal
 * is the same not-pending error an already-terminal offer gets, so the
 * response does not confirm a hidden offer exists.
 *
 * The student may re-offer: decision 18 routes `family_declined` through the
 * §4.2 resurrection branch (full submit path re-run). The family can always
 * decline again; `DO_OFFER_MAX_PER_TASK` bounds the pile-up.
 */
export const doDeclineOffer = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as Record<string, unknown>;
    const now = new Date();
    const ref = db.collection('taskOffers').doc(validOfferId(data.offerId));

    const callerData = await loadActiveCaller(uid);
    const familyId = callerFamilyId(callerData);
    if (familyId === null) {
      throw new HttpsError(
        'permission-denied',
        'Only a parent can decline an offer',
      );
    }

    let taskId = '';
    let doerUserId = '';
    let taskTitle = '';
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Offer not found');
      }
      const offer = snap.data() as OfferDoc;
      taskId = offer.taskId;
      doerUserId = offer.doerUserId;
      taskTitle = offer.taskTitle;
      if (offer.familyId !== familyId) {
        throw new HttpsError(
          'permission-denied',
          'Only the owner family can decline this offer',
        );
      }
      if (offer.status !== 'pending') {
        throw new HttpsError(
          'failed-precondition',
          'Only a pending offer can be declined',
          { reason: 'not_pending' },
        );
      }
      const taskRef = db.collection('doTasks').doc(offer.taskId);
      const taskSnap = await tx.get(taskRef);

      tx.update(ref, {
        status: 'declined',
        declinedReason: 'family_declined',
        updatedAt: now,
      });
      if (taskSnap.exists) {
        const count = (taskSnap.data()?.offerCount as number | undefined) ?? 0;
        tx.update(taskRef, {
          offerCount: Math.max(0, count - 1),
          updatedAt: now,
        });
      }
    });

    // Notify the student their offer was declined (plan §10, §13 PR9) —
    // post-commit, failures swallowed. Decision 18 allows a re-offer, and
    // the copy says so.
    await notifyDoSafely('declineOffer', async () => {
      await sendDoNotificationSafely({
        recipientUserId: doerUserId,
        type: 'task_offer_declined',
        prefCategory: 'cancelled',
        content: (lang) =>
          buildTaskOfferDeclined(lang, {
            taskTitle,
            reason: 'family_declined',
          }),
        data: { taskId, offerId: ref.id },
      });
    });

    await writeUserActivity(uid, 'do.offer_declined', {
      offerId: ref.id,
      taskId,
    });

    return { offerId: ref.id };
  },
);
