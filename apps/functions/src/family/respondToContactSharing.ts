import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import {
  isActiveGuardianOf,
  notifyChildOfGuardianAction,
} from '@ejm/shared-functions/guardian/guardianAccess.js';

interface RespondInput {
  requestId: string;
  action: 'approve' | 'decline';
}

/**
 * Babysitter responds to a contact sharing request from a family.
 * If approved, the family is added to the babysitter's approvedFamilies array,
 * making the babysitter's contact info visible to that family in search results.
 */
export const respondToContactSharing = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const { requestId, action } = request.data as RespondInput;

    if (!requestId || !action || !['approve', 'decline'].includes(action)) {
      throw new HttpsError('invalid-argument', 'requestId and action (approve/decline) are required');
    }

    // Load the request
    const requestDoc = await db.collection('contactSharingRequests').doc(requestId).get();
    if (!requestDoc.exists) {
      throw new HttpsError('not-found', 'Request not found');
    }

    const reqData = requestDoc.data()!;

    // Verify the caller is the babysitter for this request, else a GUARDIAN
    // of the babysitter — DECLINE-ONLY: approving would share the kid's
    // contact details, which only the kid consents to.
    let guardianActor = false;
    if (reqData.babysitterUserId !== uid) {
      if (await isActiveGuardianOf(uid, reqData.babysitterUserId as string)) {
        if (action !== 'decline') {
          throw new HttpsError(
            'permission-denied',
            'A guardian can decline on behalf of the kid, never accept.',
            { code: 'guardian/decline-only' },
          );
        }
        guardianActor = true;
      } else {
        throw new HttpsError('permission-denied', 'You are not the babysitter for this request');
      }
    }

    const now = new Date();

    if (action === 'approve') {
      // Update request status
      await requestDoc.ref.update({
        status: 'approved',
        respondedAt: now,
      });

      // Add familyId to babysitter's approvedFamilies
      await db.collection('users').doc(uid).update({
        'profiles.babysitter.approvedFamilies': FieldValue.arrayUnion(reqData.familyId),
      });
    } else {
      // Decline
      await requestDoc.ref.update({
        status: 'declined',
        respondedAt: now,
      });
    }

    if (guardianActor) {
      await notifyChildOfGuardianAction(
        reqData.babysitterUserId as string,
        'A parent of your family declined a contact sharing request for you.',
        { requestId },
      );
      // Guardian actions are always audited (the babysitter's own responses
      // predate auditing here and stay as they were).
      await writeUserActivity(uid, 'contact_sharing_declined', {
        requestId,
        actorRole: 'guardian',
      });
    }

    return { success: true };
  }
);
