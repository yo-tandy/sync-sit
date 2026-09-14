import { HttpsError } from 'firebase-functions/v2/https';
import { isAdmin, getParentProfile, type User } from '@ejm/shared-core';
import { db } from '../config/firebase.js';

/**
 * Family-membership gate shared by every callable that writes into (or
 * deletes from) a family-scoped Storage prefix: `createFamilyPhotoUploadUrl`,
 * `deleteFamilyPhoto` (issue #483 pulled this out of the former, where it
 * started as an inline block) and `createVerificationDocumentUploadUrl`
 * (issue #447) — ONE implementation instead of copies that could silently
 * drift apart.
 *
 * Mirrors `storage.rules`' (currently-unreachable, dead-code)
 * `canWriteFamilyDocs(callerData(), familyId)` EXACTLY: `isAdmin(caller)
 * || getParentProfile(caller)?.familyId === familyId` — an Admin SDK read
 * of `users/{uid}`, no rules involved. See `createFamilyPhotoUploadUrl`'s
 * doc comment for why the check has to live here rather than rule-side
 * (no rule-local source for the caller's `familyId` without either a
 * custom claim or the cross-service `firestore.get()` that caused the
 * #446 outage and that #449's guard now fails CI on).
 *
 * Throws `HttpsError('permission-denied', ...)` when the caller's user
 * doc does not exist, or exists but is not a member of `familyId`.
 * Returns the caller's `User` doc on success, for callers that want it.
 */
export async function assertFamilyMember(uid: string, familyId: string): Promise<User> {
  const callerDoc = await db.collection('users').doc(uid).get();
  const caller = callerDoc.data() as User | undefined;
  if (!caller) {
    throw new HttpsError('permission-denied', 'User not found');
  }
  const isMember = isAdmin(caller) || getParentProfile(caller)?.familyId === familyId;
  if (!isMember) {
    throw new HttpsError('permission-denied', 'You are not a member of this family');
  }
  return caller;
}
