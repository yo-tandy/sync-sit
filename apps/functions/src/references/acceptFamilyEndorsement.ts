import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

interface AcceptFamilyEndorsementData { referenceId: string; }

export const acceptFamilyEndorsement = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = request.data as AcceptFamilyEndorsementData;
    if (!data?.referenceId) {
      throw new HttpsError('invalid-argument', 'Missing referenceId');
    }

    const refDoc = db.collection('references').doc(data.referenceId);
    const snap = await refDoc.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Reference not found');
    }
    const ref = snap.data()!;

    if (ref.babysitterUserId !== uid) {
      throw new HttpsError('permission-denied', 'Only the babysitter can accept this endorsement');
    }
    if (ref.type !== 'family_submitted') {
      throw new HttpsError('failed-precondition', 'Only family-submitted endorsements can be accepted');
    }
    if (ref.status !== 'private') {
      throw new HttpsError('failed-precondition', 'Endorsement is no longer pending acceptance');
    }

    await refDoc.update({
      status: 'approved',
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeUserActivity(uid, 'reference.accept', {
      referenceId: data.referenceId,
      submittedByUserId: ref.submittedByUserId ?? null,
    });

    return { ok: true };
  }
);
