import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { DO_PHOTO_ID_RE } from '@ejm/do-core';
import type { User } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import {
  callerFamilyId,
  getDefaultBucket,
  getTaskOrThrow,
  isActiveEnrolledDoer,
  isAdmin,
  photoObjectPath,
} from './taskAccess.js';

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

/**
 * `doGetTaskPhotoUrl` (plan §8, §7.4 option 1): the read path for task
 * photos. Storage rules cannot express the §7.2 board audience (no
 * enrollment/status/family-membership checks in the Storage rules
 * language), so final objects are `allow read: if false` and THIS callable
 * reproduces the task read rule, then signs a short-lived URL.
 *
 * Audience — exactly §7.2's doTasks read rule:
 * - an active, fully-enrolled doer, for an OPEN task or their own
 *   assignment (the round-7 board scoping: an enrolled student must not
 *   enumerate a peer's completed engagements);
 * - a member of the task's family;
 * - an admin.
 *
 * The photo must be IN the task's `photos[]` array — the callable signs
 * `do-photos/{uid}/{photoId}` from the STORED pair, never from
 * caller-supplied halves: the stored uid is what doPostTask/doUpdateTask
 * verified at write time (§7.4's "no reconstruction, no guessing which
 * parent uploaded").
 */
export const doGetTaskPhotoUrl = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const { taskId, photoId } = (request.data ?? {}) as {
      taskId?: unknown;
      photoId?: unknown;
    };
    if (typeof photoId !== 'string' || !DO_PHOTO_ID_RE.test(photoId)) {
      throw new HttpsError('invalid-argument', 'photoId is not a valid id');
    }
    const { data: task } = await getTaskOrThrow(taskId);

    const callerDoc = await db.collection('users').doc(uid).get();
    const callerData = (callerDoc.data() ?? {}) as Record<string, unknown>;
    const isFamilyMember =
      callerFamilyId(callerData) === task.familyId &&
      (callerData.status as string | undefined) === 'active';
    const isBoardDoer =
      isActiveEnrolledDoer(callerData) &&
      (task.status === 'open' || task.assignedUserId === uid);
    // The admin disjunct requires `active` like its two siblings (both
    // check it — isFamilyMember explicitly, isActiveEnrolledDoer
    // internally): a blocked admin account must not keep a working signing
    // endpoint, the same round-1 reasoning that gated doGetOwnPhotoUrl.
    const isActiveAdmin =
      isAdmin(callerData as unknown as User) &&
      (callerData.status as string | undefined) === 'active';
    if (!isFamilyMember && !isBoardDoer && !isActiveAdmin) {
      throw new HttpsError(
        'permission-denied',
        'You do not have access to this task photo',
      );
    }

    const pair = (task.photos ?? []).find((p) => p.photoId === photoId);
    if (!pair) {
      throw new HttpsError('not-found', 'Photo is not on this task');
    }

    const file = getDefaultBucket().file(photoObjectPath(pair.uid, pair.photoId));
    try {
      const [exists] = await file.exists();
      if (!exists) {
        throw new HttpsError('not-found', 'Photo object not found');
      }
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + SIGNED_URL_TTL_MS,
        version: 'v4',
      });
      return { url: signedUrl };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error('doGetTaskPhotoUrl: failed to sign URL:', err);
      throw new HttpsError('internal', 'Failed to access photo');
    }
  },
);
