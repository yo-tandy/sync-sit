import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getConfigValue } from '../config/adminConfig.js';
import { KID_INVITE_VALIDITY_DAYS } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import {
  GUARDIAN_SUCCESS,
  hashInviteToken,
  newInviteToken,
  requireFamilyParent,
  sendKidInviteEmail,
} from './shared.js';

/**
 * Load an invite and verify the caller is a parent of its family. Shared gate
 * for cancel/resend. Invite ids are unguessable auto-ids, and both callables
 * are family-scoped — a not-found here reveals nothing useful.
 */
async function loadFamilyInvite(callerUid: string, inviteId: unknown) {
  if (!inviteId || typeof inviteId !== 'string') {
    throw new HttpsError('invalid-argument', 'inviteId is required');
  }
  const { familyId } = await requireFamilyParent(callerUid);
  const ref = db.collection('kidInvites').doc(inviteId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Invitation not found');
  }
  const invite = snap.data()!;
  if (invite.familyId !== familyId) {
    throw new HttpsError('permission-denied', 'This invitation belongs to another family');
  }
  if (invite.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'This invitation is no longer pending', {
      code: 'guardian/invite-not-pending',
    });
  }
  return { ref, invite, familyId };
}

export const cancelKidInvite = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const { inviteId } = request.data as { inviteId: string };
    const { ref, invite } = await loadFamilyInvite(request.auth.uid, inviteId);

    await ref.update({ status: 'cancelled' });
    await writeUserActivity(request.auth.uid, 'guardian.cancel_kid_invite', {
      inviteId: ref.id,
      kidEmailLower: invite.kidEmailLower,
    });
    return GUARDIAN_SUCCESS;
  },
);

/**
 * Resend rotates the token and resets the 7-day clock. A pending invite whose
 * expiry has passed is expired-at-read everywhere else (redeem rejects it);
 * resend deliberately UN-expires it — it is the parent's recovery path.
 */
export const resendKidInvite = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const { inviteId } = request.data as { inviteId: string };
    const { ref, invite } = await loadFamilyInvite(request.auth.uid, inviteId);

    const now = new Date();
    const rawToken = newInviteToken();
    await ref.update({
      tokenHash: hashInviteToken(rawToken),
      expiresAt: new Date(now.getTime() + (await getConfigValue('kidInviteValidityDays')) * 86400_000),
      resentAt: now,
    });

    const familyName: string =
      (await db.collection('families').doc(invite.familyId).get()).data()?.familyName || 'your';
    await sendKidInviteEmail(invite.kidEmailLower, invite.firstName, familyName, rawToken);

    await writeUserActivity(request.auth.uid, 'guardian.resend_kid_invite', {
      inviteId: ref.id,
      kidEmailLower: invite.kidEmailLower,
    });
    return GUARDIAN_SUCCESS;
  },
);
