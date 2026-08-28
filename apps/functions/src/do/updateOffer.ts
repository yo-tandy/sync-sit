import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  validateAvailabilityNote,
  validateOfferHelper,
  validateOfferMessage,
  validatePrice,
  validatePriceBasis,
  type OfferDoc,
} from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { loadActiveCaller, validOfferId } from './offerAccess.js';

/**
 * `doUpdateOffer` (plan §4.2, §8): the offering student edits price /
 * message / helper / availabilityNote in place, while `pending` ONLY.
 *
 * `pending_guardian` is deliberately not editable: the parent approved (or
 * is looking at) a SPECIFIC price and message, and editing under them would
 * be the §4.2 laundering hole in miniature. A student who wants different
 * terms on a gated offer withdraws and re-submits — which re-runs the gate.
 * Terminal statuses are re-submissions (the resurrection matrix), never
 * edits.
 *
 * The full §4.2 terms group is required each call (the form posts the whole
 * fieldset), so the stored doc never mixes two submissions' halves.
 */
export const doUpdateOffer = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as Record<string, unknown>;
    const now = new Date();
    const ref = db.collection('taskOffers').doc(validOfferId(data.offerId));

    for (const err of [
      validatePrice(data.price),
      validatePriceBasis(data.priceBasis),
      validateOfferMessage(data.message),
      validateOfferHelper(data.helper ?? null),
      validateAvailabilityNote(data.availabilityNote ?? null),
    ]) {
      if (err) throw new HttpsError('invalid-argument', err);
    }
    const rawHelper = (data.helper ?? null) as
      | { firstName: string; lastName: string; age: number }
      | null;
    const helper = rawHelper
      ? {
          firstName: rawHelper.firstName.trim(),
          lastName: rawHelper.lastName.trim(),
          age: rawHelper.age,
        }
      : null;

    await loadActiveCaller(uid);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Offer not found');
      }
      const offer = snap.data() as OfferDoc;
      if (offer.doerUserId !== uid) {
        throw new HttpsError(
          'permission-denied',
          'Only the offering student can edit an offer',
        );
      }
      if (offer.status !== 'pending') {
        throw new HttpsError(
          'failed-precondition',
          'Only a pending offer can be edited',
          { reason: 'not_pending' },
        );
      }
      tx.update(ref, {
        price: data.price as number,
        priceBasis: data.priceBasis as 'flat' | 'hourly',
        message: (data.message as string).trim(),
        helper,
        availabilityNote:
          typeof data.availabilityNote === 'string'
            ? data.availabilityNote.trim() || null
            : null,
        updatedAt: now,
      });
    });

    await writeUserActivity(uid, 'do.offer_updated', { offerId: ref.id });

    return { offerId: ref.id };
  },
);
