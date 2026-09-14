import { HttpsError } from 'firebase-functions/v2/https';
import { isAdmin, getParentProfile, type User } from '@ejm/shared-core';
import { db } from '../config/firebase.js';

/**
 * Admin-SDK family-membership check shared by every signed-URL upload
 * callable that writes into a family-scoped Storage prefix —
 * `createFamilyPhotoUploadUrl` (issue #471) and `createVerificationDocumentUploadUrl`
 * (issue #447). Extracted out of the former so the two callables can't drift:
 * both need to mirror storage.rules' now-dead `canWriteFamilyDocs(callerData(),
 * familyId)` EXACTLY — `isAdmin(caller) || caller.profiles.parent.familyId
 * === familyId` — since that helper is the one thing standing between "a
 * cross-service rule construct" (the #446 outage) and "an Admin-SDK read in
 * a callable" (this repo's fix for both paths).
 *
 * Throws `HttpsError('permission-denied', ...)` when the caller doesn't
 * qualify (no user doc, or a user doc that isn't an admin/member of
 * `familyId`); resolves with no value otherwise.
 */
export async function assertFamilyMembership(uid: string, familyId: string): Promise<void> {
  const callerDoc = await db.collection('users').doc(uid).get();
  const caller = callerDoc.data() as User | undefined;
  if (!caller) {
    throw new HttpsError('permission-denied', 'User not found');
  }
  const isMember = isAdmin(caller) || getParentProfile(caller)?.familyId === familyId;
  if (!isMember) {
    throw new HttpsError('permission-denied', 'You are not a member of this family');
  }
}
