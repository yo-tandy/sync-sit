import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import type { FamilyDoc } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { assertFamilyMember } from './familyMembership.js';

const FAMILY_PHOTOS_PREFIX = 'family-photos';

/**
 * `deleteFamilyPhoto` (issue #483, follow-up to #471/#482): the only
 * deleter of `family-photos/**` left once `storage.rules` sets that
 * path's `delete` to `if false` too. PR #482 closed the WRITE gap
 * (`createFamilyPhotoUploadUrl`) but deliberately left `delete` unscoped
 * (`request.auth != null`), reasoning that a delete cannot plant
 * attacker-controlled content. Issue #483 revisits that: an unscoped
 * delete is still a live griefing/availability vector (any authenticated
 * stranger — a babysitter, an unrelated family — can delete ANY family's
 * photo directly via the client SDK), and the "membership can't be
 * checked rule-side without a cross-service lookup" constraint (#449)
 * applies here exactly as it did to the write side.
 *
 * Shares `assertFamilyMember` (`./familyMembership.js`) with
 * `createFamilyPhotoUploadUrl` — ONE implementation of
 * `isAdmin(caller) || getParentProfile(caller)?.familyId === familyId`,
 * not two copies that could drift apart.
 *
 * `objectPath` is validated to be a DIRECT child of
 * `family-photos/{familyId}/`, using the SAME `familyId` just checked for
 * membership — so a member of family A can never reach into family B's
 * prefix by passing a mismatched `familyId`/`objectPath` pair (that is an
 * `invalid-argument`, decided before membership is even looked up, not a
 * membership question), and no nested path or traversal segment is
 * accepted (the remainder after the prefix must be a single path segment
 * with no further `/`).
 *
 * Deletes are idempotent (`ignoreNotFound`) — a retry, a double-click, or
 * a race with the object already being gone all succeed the same way,
 * mirroring the Admin-SDK cleanup idiom used elsewhere in this codebase
 * (`doGdpr.ts`, `sweepTasks.ts`, `stripTaskPhoto.ts`, `taskAccess.ts`).
 *
 * If the family doc's `photoUrl` currently points at the deleted object,
 * it is cleared in the same call — a safety net for ANY caller of this
 * callable, not just `FamilySettingsPage`'s own replace/remove flow
 * (which already updates `photoUrl` itself, via `updateDoc`, before
 * calling this for the OLD object — so in that flow `photoUrl` normally
 * no longer points at `objectPath` by the time this runs).
 */
export const deleteFamilyPhoto = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { familyId, objectPath } = (request.data ?? {}) as {
      familyId?: unknown;
      objectPath?: unknown;
    };

    if (typeof familyId !== 'string' || familyId.length === 0) {
      throw new HttpsError('invalid-argument', 'familyId is required');
    }
    if (typeof objectPath !== 'string' || objectPath.length === 0) {
      throw new HttpsError('invalid-argument', 'objectPath is required');
    }

    // Path guard — objectPath must be a DIRECT child of THIS family's own
    // photo prefix (same familyId as above). No traversal, no other
    // family's path, no nested sub-path.
    const prefix = `${FAMILY_PHOTOS_PREFIX}/${familyId}/`;
    const remainder = objectPath.startsWith(prefix) ? objectPath.slice(prefix.length) : null;
    if (!remainder || remainder.length === 0 || remainder.includes('/') || remainder.includes('..')) {
      throw new HttpsError(
        'invalid-argument',
        "objectPath must be a direct child of this family's photo prefix",
      );
    }

    // Membership check — shared with createFamilyPhotoUploadUrl (issue
    // #483), mirrors storage.rules' canWriteFamilyDocs(callerData(),
    // familyId) exactly.
    await assertFamilyMember(request.auth.uid, familyId);

    const bucket = getStorage().bucket();
    await bucket.file(objectPath).delete({ ignoreNotFound: true });

    // Clear photoUrl if it still points at the object we just deleted —
    // getDownloadURL encodes the object path's '/' as '%2F' in the `o/`
    // segment, so the encoded objectPath is a reliable substring check
    // (same shape as FamilySettingsPage.tsx's pathFromDownloadUrl, in
    // reverse).
    const familyRef = db.collection('families').doc(familyId);
    const familySnap = await familyRef.get();
    const family = familySnap.data() as FamilyDoc | undefined;
    if (family?.photoUrl && family.photoUrl.includes(encodeURIComponent(objectPath))) {
      await familyRef.update({ photoUrl: null });
    }

    return { success: true };
  },
);
