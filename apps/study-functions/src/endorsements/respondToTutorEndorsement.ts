import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { respondTutorEndorsementSchema } from '../validation/endorsement.js';

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
    const snap = await refDoc.get();
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
      await refDoc.update({
        status: 'approved',
        approvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await refDoc.update({
        status: 'removed',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await writeUserActivity(
      uid,
      action === 'accept' ? 'tutor_endorsement_accepted' : 'tutor_endorsement_dismissed',
      { referenceId, submittedByFamilyId: ref.submittedByFamilyId ?? null },
    );

    return { ok: true };
  },
);
