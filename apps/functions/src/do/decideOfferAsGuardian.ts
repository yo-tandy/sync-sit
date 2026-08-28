import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { OfferDoc } from '@ejm/do-core';
import { requireActiveLinkParent } from '@ejm/shared-functions/guardian/oversight.js';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { loadActiveCaller, validOfferId } from './offerAccess.js';

/**
 * `doDecideOfferAsGuardian` (plan §6.2, §8): the supervising parent decides
 * a `pending_guardian` offer.
 *
 * - approve → `pending`: the hiring family sees it (their §7.2 allow-list
 *   admits `pending`); the offer stays in the live set, so `offerCount`
 *   does not move.
 * - deny → **`withdrawn`** — deliberately the same status the student's own
 *   `doWithdrawOffer` writes, NOT a `declined` variant: §6.2's invisibility
 *   promise means the hiring family can never learn a guardian said no.
 *   `withdrawn` is outside their allow-list and indistinguishable from
 *   self-withdrawal. The offer leaves the live set, so `offerCount`
 *   decrements.
 *
 * Authorization is the guardian machinery's own gate: the caller must be a
 * parent of the family holding the CHILD'S ACTIVE guardianLinks doc
 * (`requireActiveLinkParent` — "no link", "not active" and "someone else's
 * family" are one indistinguishable refusal). The CURRENT active link is the
 * authority, not the `guardian.familyId` snapshot written at submit time:
 * supervision could have moved families since, and the power follows the
 * live link exactly as every other guardian protective control does.
 *
 * The decision is recorded on the `guardian` map (decidedAt/decidedByUid) —
 * readable by the student (own-offer disjunct) and admin; never by the
 * hiring family (denial leaves `withdrawn`, outside their allow-list; an
 * approved offer's map records only that the student's parent approved,
 * which the §6.2 flow already tells the family nothing about).
 */
export const doDecideOfferAsGuardian = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as Record<string, unknown>;
    const now = new Date();
    const ref = db.collection('taskOffers').doc(validOfferId(data.offerId));

    if (data.decision !== 'approve' && data.decision !== 'deny') {
      throw new HttpsError(
        'invalid-argument',
        'decision must be approve or deny',
      );
    }
    const approve = data.decision === 'approve';

    await loadActiveCaller(uid);

    // Standing: read the offer once to learn the child, then assert the
    // caller holds that child's ACTIVE link (its own db reads — outside the
    // transaction, like every other guardian control). The transaction
    // re-reads and re-asserts the offer status, so a concurrent decide /
    // withdraw / acceptance loses cleanly.
    const preSnap = await ref.get();
    if (!preSnap.exists) {
      throw new HttpsError('not-found', 'Offer not found');
    }
    const childUid = (preSnap.data() as OfferDoc).doerUserId;
    await requireActiveLinkParent(uid, childUid);

    let taskId = '';
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Offer not found');
      }
      const offer = snap.data() as OfferDoc;
      taskId = offer.taskId;
      if (offer.status !== 'pending_guardian') {
        throw new HttpsError(
          'failed-precondition',
          'This offer is not awaiting a guardian decision',
          { reason: 'not_pending_guardian' },
        );
      }
      const taskRef = db.collection('doTasks').doc(offer.taskId);
      const taskSnap = await tx.get(taskRef);

      tx.update(ref, {
        status: approve ? 'pending' : 'withdrawn',
        'guardian.decidedAt': now,
        'guardian.decidedByUid': uid,
        updatedAt: now,
      });
      // Denial leaves the live set → §4.1's invariant decrements; approval
      // stays live (pending_guardian → pending) → count untouched.
      if (!approve && taskSnap.exists) {
        const count = (taskSnap.data()?.offerCount as number | undefined) ?? 0;
        tx.update(taskRef, {
          offerCount: Math.max(0, count - 1),
          updatedAt: now,
        });
      }
    });

    // PR9: tell the student a parent acted (supervision is transparent —
    // the notifyChildOfGuardianAction shape), and on approval notify the
    // hiring family of the now-visible offer. No notification plumbing in
    // PR6.

    await writeUserActivity(uid, 'do.offer_guardian_decided', {
      offerId: ref.id,
      taskId,
      childUid,
      decision: approve ? 'approve' : 'deny',
    });

    return { offerId: ref.id, status: approve ? 'pending' : 'withdrawn' };
  },
);
