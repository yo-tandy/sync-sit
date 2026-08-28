import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { OfferDoc, TaskDoc } from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { callerFamilyId } from './taskAccess.js';
import {
  OFFER_LIVE_STATUSES,
  loadActiveCaller,
  tsMillis,
  validOfferId,
} from './offerAccess.js';

/**
 * `doAcceptOffer` — the §6.4 transaction, transcribed step by step. One
 * Firestore transaction, reads first then writes (the Admin SDK throws on a
 * read after any write), which is why acceptance is transactional and not a
 * sequence of writes: a second parent accepting a different offer
 * concurrently must lose.
 *
 * The write set is bounded by `DO_OFFER_MAX_PER_TASK` (25): step 8 declines
 * exactly the LIVE offers, and `doSubmitOffer` caps live offers per task —
 * far below Firestore's hard 500-writes-per-transaction limit, as a bound
 * rather than a "very likely fine".
 */
export const doAcceptOffer = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as Record<string, unknown>;
    const now = new Date();
    const offerRef = db
      .collection('taskOffers')
      .doc(validOfferId(data.offerId));

    const callerData = await loadActiveCaller(uid);
    const familyId = callerFamilyId(callerData);
    if (familyId === null) {
      throw new HttpsError(
        'permission-denied',
        'Only a parent can accept an offer',
      );
    }

    let taskId = '';
    let doerUserId = '';
    let agreedPrice = 0;
    await db.runTransaction(async (tx) => {
      // ── Read phase (§6.4 steps 1-5) ──
      // The offer names the task, so it is fetched first mechanically; the
      // ASSERTIONS run in the §6.4 step order below.
      const offerSnap = await tx.get(offerRef);
      if (!offerSnap.exists) {
        throw new HttpsError('not-found', 'Offer not found');
      }
      const offer = offerSnap.data() as OfferDoc;
      const taskRef = db.collection('doTasks').doc(offer.taskId);

      // Step 1: read the task; status == 'open' and expiresAt > now.
      const taskSnap = await tx.get(taskRef);
      if (!taskSnap.exists) {
        throw new HttpsError('not-found', 'Task not found');
      }
      const task = taskSnap.data() as TaskDoc;
      if (task.status !== 'open') {
        throw new HttpsError(
          'failed-precondition',
          'This task is no longer open',
          { reason: 'task_not_open' },
        );
      }
      if (tsMillis(task.expiresAt) <= now.getTime()) {
        throw new HttpsError(
          'failed-precondition',
          'This task has expired',
          { reason: 'task_expired' },
        );
      }

      // Step 2: offer is 'pending' and its taskId matches the task read.
      // NOT 'pending_guardian': an undecided guardian-gated offer is
      // invisible to the family (§6.2) and must stay unacceptable.
      if (offer.status !== 'pending') {
        throw new HttpsError(
          'failed-precondition',
          'Only a pending offer can be accepted',
          { reason: 'not_pending' },
        );
      }
      if (offer.taskId !== task.taskId) {
        throw new HttpsError('failed-precondition', 'Offer/task mismatch');
      }

      // Step 3: the caller is a member of the task's family.
      if (familyId !== task.familyId) {
        throw new HttpsError(
          'permission-denied',
          'Only the owner family can accept an offer',
        );
      }

      // Step 4: the offering student is still active and enrolled — a ban
      // or account deletion between offer and acceptance must not produce
      // an assignment.
      const studentSnap = await tx.get(
        db.collection('users').doc(offer.doerUserId),
      );
      const student = (studentSnap.data() ?? {}) as Record<string, unknown>;
      const studentDoer = (
        (student.profiles ?? {}) as Record<string, Record<string, unknown> | undefined>
      ).doer;
      if (
        (student.status as string | undefined) !== 'active' ||
        studentDoer?.enrollmentComplete !== true
      ) {
        throw new HttpsError(
          'failed-precondition',
          'This student is no longer available',
          { reason: 'doer_unavailable' },
        );
      }

      // Step 5: read the sibling LIVE offers — hoisted here because step 8
      // needs them and no read may follow step 6 (all reads before all
      // writes).
      const liveOffers = await tx.get(
        db
          .collection('taskOffers')
          .where('taskId', '==', task.taskId)
          .where('status', 'in', [...OFFER_LIVE_STATUSES]),
      );

      // ── Write phase (§6.4 steps 6-8) ──
      // Step 6: task → assigned, plus offerCount → 0: acceptance is the one
      // path where EVERY live offer leaves the live set at once (winner →
      // accepted, siblings → declined/expired), so the §4.1 invariant must
      // land at zero inside this same transaction — the fourth decrement
      // path, alongside withdraw, decline and cancel.
      agreedPrice = offer.price;
      tx.update(taskRef, {
        status: 'assigned',
        assignedUserId: offer.doerUserId,
        assignedOfferId: offerRef.id,
        assignedAt: now,
        agreedPrice,
        offerCount: 0,
        updatedAt: now,
      });

      // Step 7: the accepted offer → accepted.
      tx.update(offerRef, { status: 'accepted', updatedAt: now });

      // Step 8: every other live offer, from the step-5 read. `pending` →
      // `declined` / 'sibling_accepted'. Every `pending_guardian` sibling →
      // **`expired`** — NOT `declined`, because `declined` is in the
      // family's §7.2 allow-list. Routing an undecided guardian-gated offer
      // to `declined` would let the family read it (doer name, photo, bio,
      // price, message, the helper's name and age) the moment they accepted
      // anyone — an action entirely under their control, so a family could
      // accept-then-read specifically to flush offers a parent never
      // approved. `expired` is the status doCancelTask already uses for
      // "the task went away underneath you," the allow-list already
      // excludes it, and it is the truthful description: nobody declined
      // this offer, its moment passed. §6.2's invisibility promise thus
      // holds through BOTH exits — guardian denial and sibling acceptance.
      for (const sibling of liveOffers.docs) {
        if (sibling.id === offerRef.id) continue;
        const siblingStatus = (sibling.data() as OfferDoc).status;
        if (siblingStatus === 'pending') {
          tx.update(sibling.ref, {
            status: 'declined',
            declinedReason: 'sibling_accepted',
            updatedAt: now,
          });
        } else {
          tx.update(sibling.ref, { status: 'expired', updatedAt: now });
        }
      }

      taskId = task.taskId;
      doerUserId = offer.doerUserId;
    });

    // Step 9 — PR9: notify the winner, each loser, and the winner's
    // guardian if there is an active link (outside the transaction —
    // notifications are not transactional writes). No notification
    // plumbing in PR6.

    // Step 10: audit the assignment.
    await writeUserActivity(uid, 'do.offer_accepted', {
      offerId: offerRef.id,
      taskId,
      doerUserId,
      agreedPrice,
    });

    return { taskId, offerId: offerRef.id, agreedPrice };
  },
);
