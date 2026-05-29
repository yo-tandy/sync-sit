import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from '../admin/verifyAdmin.js';
import { writeAuditLog } from '../admin/writeAuditLog.js';

interface PublishManualReferenceData { referenceId: string; }

export const publishManualReference = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    await verifyAdmin(uid);

    const data = request.data as PublishManualReferenceData;
    if (!data?.referenceId) {
      throw new HttpsError('invalid-argument', 'Missing referenceId');
    }

    const refDoc = db.collection('references').doc(data.referenceId);
    const snap = await refDoc.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Reference not found');
    }
    const ref = snap.data()!;
    if (ref.type !== 'manual') {
      throw new HttpsError('failed-precondition', 'Only manual references can be published via this path');
    }
    if (ref.status !== 'private') {
      throw new HttpsError('failed-precondition', 'Reference is not in private status');
    }

    await refDoc.update({
      status: 'published',
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      adminUserId: uid,
      action: 'reference.publish',
      details: {
        referenceId: data.referenceId,
        babysitterUserId: ref.babysitterUserId,
      },
    });

    return { ok: true };
  }
);
