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

    // Either membership field counts, caller and target alike (issue #279):
    // a fully-legacy Plan C family carries membership at the ROOT familyId.
    const callerFamilyId = caller.familyId ?? (callerDoc.data() as { familyId?: string })?.familyId;
    if (!callerFamilyId) {
      throw new HttpsError('failed-precondition', 'No family associated');
    }

    // Defence-in-depth on the CALLER (round-6 review): the pointer and
    // parentIds can diverge -- the pre-fix callable created exactly that in
    // prod -- so caller authorization must not rest on the caller's own
    // pointer alone. The family doc is the authority: a stale-pointer
    // ex-member cannot remove a genuine remaining member.
    const familySnap = await db.collection('families').doc(callerFamilyId).get();
    const familyParentIds = (familySnap.data()?.parentIds ?? []) as string[];
    if (!familySnap.exists || !familyParentIds.includes(uid)) {
      throw new HttpsError('permission-denied', 'You are not a member of this family');
    }

    // Verify target is in the same family (either membership field).
    const targetDoc = await db.collection('users').doc(targetUserId).get();
    const targetData = targetDoc.data() as (User & { familyId?: string }) | undefined;
    const targetMembership = getParentProfile(targetData)?.familyId ?? targetData?.familyId;
    if (!targetDoc.exists || targetMembership !== callerFamilyId) {
      throw new HttpsError('not-found', 'User is not in your family');
    }

    // INVARIANTS (issue #279, PR #284): membership is cleared where access
    // control reads it -- BOTH profiles.parent.familyId (storage.rules,
    // getVerificationDocument, every getParentProfile consumer) and the
    // legacy root familyId -- atomically with the parentIds trim (a batch
    // is atomic across collections; a partial state either direction is an
    // access-control hole). The family-less parent profile that remains is
    // re-attachable through a fresh invite (addProfileToUser's
    // orphan-parent carve-out).
    const batch = db.batch();
    batch.update(db.collection('users').doc(targetUserId), {
      'profiles.parent.familyId': FieldValue.delete(),
      familyId: FieldValue.delete(),
    });
    batch.update(db.collection('families').doc(callerFamilyId), {
      parentIds: FieldValue.arrayRemove(targetUserId),
    });
    await batch.commit();

    await writeUserActivity(uid, 'remove_co_parent', { targetUserId, familyId: callerFamilyId });

    return { success: true };
  }
);
