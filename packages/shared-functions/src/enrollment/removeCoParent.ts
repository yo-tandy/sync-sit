import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { FieldValue } from 'firebase-admin/firestore';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { getParentProfile, type User } from '@ejm/shared-core';

interface RemoveCoParentInput {
  targetUserId: string;
}

export const removeCoParent = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const { targetUserId } = request.data as RemoveCoParentInput;

    if (!targetUserId) {
      throw new HttpsError('invalid-argument', 'targetUserId is required');
    }

    if (targetUserId === uid) {
      throw new HttpsError('failed-precondition', 'You cannot remove yourself');
    }

    // Verify caller is a parent
    const callerDoc = await db.collection('users').doc(uid).get();
    const caller = getParentProfile(callerDoc.data() as User | undefined);
    if (!caller) {
      throw new HttpsError('permission-denied', 'Only parents can remove co-parents');
    }

    const callerFamilyId = caller.familyId;
    if (!callerFamilyId) {
      throw new HttpsError('failed-precondition', 'No family associated');
    }

    // Verify target is in the same family
    const targetDoc = await db.collection('users').doc(targetUserId).get();
    if (!targetDoc.exists || getParentProfile(targetDoc.data() as User | undefined)?.familyId !== callerFamilyId) {
      throw new HttpsError('not-found', 'User is not in your family');
    }

    // Remove from family parentIds
    await db.collection('families').doc(callerFamilyId).update({
      parentIds: FieldValue.arrayRemove(targetUserId),
    });

    // Clear the target's family membership where membership actually
    // LIVES: profiles.parent.familyId (Plan D) -- the field this callable's
    // own gate just read, and the one storage.rules and
    // getVerificationDocument key off. The bare root familyId is a Plan C
    // leftover Plan D never populates; clearing only it left a removed
    // co-parent with full membership everywhere the user doc is consulted
    // (issue #279). Root field still cleared for legacy docs that carry it.
    await db.collection('users').doc(targetUserId).update({
      'profiles.parent.familyId': FieldValue.delete(),
      familyId: FieldValue.delete(),
    });

    await writeUserActivity(uid, 'remove_co_parent', { targetUserId, familyId: callerFamilyId });

    return { success: true };
  }
);
