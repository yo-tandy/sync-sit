import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { respondTutorEndorsementSchema } from '../validation/endorsement.js';
import {
  notifyEndorsementOutcome,
  recordEndorsementResponseActivity,
} from './endorsementNotifications.js';

export const respondToTutorEndorsement = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = respondTutorEndorsementSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid parameters',
      );
    }
    const { referenceId, action } = parsed.data;

    const refDoc = db.collection('references').doc(referenceId);

    // Load → check → update atomically. On accept we ALSO increment the tutor's
    // server-owned endorsementCount in the same transaction, so the denormalized
    // counter searchTutors reads can never drift from the reference it counts.
    // Nothing decrements here: 'removed' only happens pre-approval via dismiss
    // (which never incremented). If a future admin-moderation flow ever removes
    // an already-approved endorsement, THAT flow owns the matching decrement.
    const submittedByFamilyId = await db.runTransaction(async (tx) => {
      const snap = await tx.get(refDoc);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Endorsement not found');
      }
      const ref = snap.data()!;

      if (ref.tutorUserId !== uid) {
        throw new HttpsError('permission-denied', 'Only the endorsed tutor can respond to this endorsement');
      }
      if (ref.type !== 'family_submitted') {
        throw new HttpsError('failed-precondition', 'Only family-submitted endorsements can be responded to');
      }
      if (ref.status !== 'private') {
        throw new HttpsError('failed-precondition', 'Endorsement is no longer pending');
      }

      if (action === 'accept') {
        tx.update(refDoc, {
          status: 'approved',
          approvedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(db.collection('users').doc(uid), {
          'profiles.tutor.endorsementCount': FieldValue.increment(1),
        });
      } else {
        tx.update(refDoc, {
          status: 'removed',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return (ref.submittedByFamilyId as string | undefined) ?? null;
    });

    // ── Post-commit, best-effort work ──
    // The transaction above has already committed; NOTHING below may fail the
    // callable. A rejection here would leave the tutor's UI reporting an error
    // for an action that succeeded (a retry then hits the status guard with
    // failed-precondition). Both helpers swallow their own failures — the
    // result always reflects the committed state.
    await recordEndorsementResponseActivity(uid, action, referenceId, submittedByFamilyId);

    if (submittedByFamilyId) {
      await notifyEndorsementOutcome(uid, action, referenceId, submittedByFamilyId);
    }

    return { ok: true };
  },
);
