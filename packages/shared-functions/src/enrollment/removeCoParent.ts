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

    // Verify target is in the same family: any membership signal counts --
    // either pointer field naming this family, or presence in parentIds
    // (round-7 review: a parentIds-listed target with a divergent or absent
    // pointer holds the WIDER rules-side grants and must stay removable).
    const targetDoc = await db.collection('users').doc(targetUserId).get();
    const targetData = targetDoc.data() as (User & { familyId?: string }) | undefined;
    const targetPointer = getParentProfile(targetData)?.familyId;
    const targetRoot = targetData?.familyId;
    const targetIsMember =
      targetPointer === callerFamilyId ||
      targetRoot === callerFamilyId ||
      familyParentIds.includes(targetUserId);
    if (!targetDoc.exists || !targetIsMember) {
      throw new HttpsError('not-found', 'User is not in your family');
    }

    // INVARIANTS (issue #279, PR #284): membership is cleared where access
    // control reads it, PER FIELD -- only pointer fields naming THIS family
    // are deleted (round-7 review: an unconditional both-field delete could
    // destroy a live membership in a different family, the same inverse-#279
    // the backfill's per-field classification exists to avoid) -- atomically
    // with the parentIds trim. The family-less parent profile that remains
    // is re-attachable through a fresh invite (addProfileToUser's
    // orphan-parent carve-out).
    const pointerDeletes: Record<string, FieldValue> = {};
    if (targetPointer === callerFamilyId) pointerDeletes['profiles.parent.familyId'] = FieldValue.delete();
    if (targetRoot === callerFamilyId) pointerDeletes['familyId'] = FieldValue.delete();
    const batch = db.batch();
    if (Object.keys(pointerDeletes).length > 0) {
      batch.update(db.collection('users').doc(targetUserId), pointerDeletes);
    }
    batch.update(db.collection('families').doc(callerFamilyId), {
      parentIds: FieldValue.arrayRemove(targetUserId),
    });
    await batch.commit();

    await writeUserActivity(uid, 'remove_co_parent', { targetUserId, familyId: callerFamilyId });

    return { success: true };
  }
);
