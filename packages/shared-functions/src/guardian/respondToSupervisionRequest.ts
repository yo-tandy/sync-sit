import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { notifyAllParents } from '../config/notifyParents.js';
import { GUARDIAN_SUCCESS } from './shared.js';

interface RespondData {
  accept: boolean;
}

/**
 * The kid answers an ask-to-supervise request (claim origin only — a pending
 * parent_created link can only activate through redeemKidInvite). Accepting
 * activates the link and sets the governedBy mirror; declining DELETES the
 * link, so the parent sees exactly what an ignored request looks like, and a
 * later re-ask stays possible.
 */
export const respondToSupervisionRequest = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = request.data as RespondData;
    if (typeof data.accept !== 'boolean') {
      throw new HttpsError('invalid-argument', 'accept must be a boolean');
    }

    const linkRef = db.collection('guardianLinks').doc(uid);
    const linkSnap = await linkRef.get();
    const link = linkSnap.data();
    if (!link || link.status !== 'pending' || link.origin !== 'claim') {
      throw new HttpsError('failed-precondition', 'There is no pending supervision request.', {
        code: 'guardian/no-pending-request',
      });
    }

    const now = new Date();

    if (!data.accept) {
      await linkRef.delete();
      await writeUserActivity(uid, 'guardian.supervision_declined', {
        familyId: link.familyId,
      });
      return GUARDIAN_SUCCESS;
    }

    await linkRef.update({ status: 'active', confirmedAt: now });
    // Mirror present ⇔ link ACTIVE.
    await db.collection('users').doc(uid).update({
      governedBy: { familyId: link.familyId, linkedAt: now },
      updatedAt: now,
    });

    const kid = (await db.collection('users').doc(uid).get()).data();
    const kidName = kid?.firstName || 'Your kid';
    await notifyAllParents({
      familyId: link.familyId,
      prefCategory: 'confirmed',
      type: 'supervision_confirmed',
      title: 'Supervision confirmed',
      body: `${kidName} accepted your supervision request`,
      emailSubject: 'Supervision confirmed',
      emailBody: `<p>${kidName} accepted your supervision request. You can now follow their activity from your dashboard.</p>`,
      data: { childUid: uid },
    });

    await writeUserActivity(uid, 'guardian.supervision_accepted', {
      familyId: link.familyId,
    });
    return GUARDIAN_SUCCESS;
  },
);
