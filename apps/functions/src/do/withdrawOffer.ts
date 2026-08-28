import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { OfferDoc } from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { loadActiveCaller, validOfferId } from './offerAccess.js';

/**
 * `doWithdrawOffer` (plan §4.2, §8): the offering student pulls a LIVE offer
 * (`pending` or `pending_guardian`) → `withdrawn`, decrementing the live
 * `offerCount` in the same transaction (§4.1's invariant: the count moves
 * whenever an offer leaves the live set by ANY path).
 *
 * The doc is kept, not deleted — the deterministic offerId makes re-offering
 * a resurrection through `doSubmitOffer`'s full path (§4.2), and `withdrawn`
 * is outside the family's §7.2 allow-list, which is half of §6.2's
 * invisibility promise (guardian denial writes the same status precisely so
 * the family cannot tell the two apart).
 */
export const doWithdrawOffer = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as Record<string, unknown>;
    const now = new Date();
    const ref = db.collection('taskOffers').doc(validOfferId(data.offerId));

    await loadActiveCaller(uid);

    let taskId = '';
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Offer not found');
      }
      const offer = snap.data() as OfferDoc;
      taskId = offer.taskId;
      if (offer.doerUserId !== uid) {
        throw new HttpsError(
          'permission-denied',
          'Only the offering student can withdraw an offer',
        );
      }
      if (offer.status !== 'pending' && offer.status !== 'pending_guardian') {
        throw new HttpsError(
          'failed-precondition',
          'Only a live offer can be withdrawn',
          { reason: 'not_live' },
        );
      }
      const taskRef = db.collection('doTasks').doc(offer.taskId);
      const taskSnap = await tx.get(taskRef);

      tx.update(ref, { status: 'withdrawn', updatedAt: now });
      // The task normally exists (offers are deleted with their task by the
      // sweep); guard anyway so a half-swept pair still withdraws cleanly.
      if (taskSnap.exists) {
        const count = (taskSnap.data()?.offerCount as number | undefined) ?? 0;
        tx.update(taskRef, {
          offerCount: Math.max(0, count - 1),
          updatedAt: now,
        });
      }
    });

    await writeUserActivity(uid, 'do.offer_withdrawn', {
      offerId: ref.id,
      taskId,
    });

    return { offerId: ref.id };
  },
);
