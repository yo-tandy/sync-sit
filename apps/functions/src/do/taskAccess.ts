import { HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { getParentProfile, isAdmin, type User } from '@ejm/shared-core';
import type { TaskDoc } from '@ejm/do-core';
import { db } from '../config/firebase.js';

/**
 * Shared caller/photo plumbing for the sync-do task callables (plan §7.4,
 * §8, §11.1). Kept out of do-core on purpose: everything here touches
 * firebase-admin, and do-core is a leaf package the frontends consume.
 */

/** The §7.4 final-object path for a stored `{uid, photoId}` pair. */
export function photoObjectPath(uid: string, photoId: string): string {
  return `do-photos/${uid}/${photoId}`;
}

/** The §7.4 quarantine prefix (client uploads; the stripper's input). */
export const DO_UPLOADS_PREFIX = 'do-uploads/';
/** The §7.4 final prefix (stripper output; callable-signed reads only). */
export const DO_PHOTOS_PREFIX = 'do-photos/';

/**
 * The default bucket, resolved lazily: `getStorage()` needs the admin app,
 * and the emulator injects FIREBASE_CONFIG.storageBucket at runtime.
 */
export function getDefaultBucket() {
  return getStorage().bucket();
}

export interface VerifiedFamilyCaller {
  uid: string;
  callerData: Record<string, unknown>;
  familyId: string;
  familyData: Record<string, unknown>;
}

/**
 * The posting gate (plan §11.1, decision 14): the caller must be a parent
 * whose family is FULLY verified — `verification.isFullyVerified`, the one
 * portable, cross-app approval (never a per-app verification state). The
 * familyId is derived server-side from the caller's own profile, never from
 * input (the publishSearch precedent).
 */
export async function loadVerifiedFamilyCaller(
  uid: string,
): Promise<VerifiedFamilyCaller> {
  const callerDoc = await db.collection('users').doc(uid).get();
  const callerData = (callerDoc.data() ?? {}) as Record<string, unknown>;
  if ((callerData.status as string | undefined) !== 'active') {
    throw new HttpsError('permission-denied', 'Account is not active');
  }
  const parent = getParentProfile(callerData as unknown as User);
  if (!parent?.familyId) {
    throw new HttpsError('permission-denied', 'Only parents can manage tasks');
  }
  const familyDoc = await db.collection('families').doc(parent.familyId).get();
  const familyData = familyDoc.data();
  if (!familyData?.verification?.isFullyVerified) {
    throw new HttpsError(
      'permission-denied',
      'Family verification required before posting a task',
    );
  }
  return { uid, callerData, familyId: parent.familyId, familyData };
}

/** Family membership without the verification gate (cancel/complete/read). */
export function callerFamilyId(
  callerData: Record<string, unknown>,
): string | null {
  return getParentProfile(callerData as unknown as User)?.familyId ?? null;
}

/** Is this caller doc an active, fully-enrolled doer (the §7.2 audience)? */
export function isActiveEnrolledDoer(
  callerData: Record<string, unknown>,
): boolean {
  const doer = (
    (callerData.profiles ?? {}) as Record<string, Record<string, unknown> | undefined>
  ).doer;
  return (
    doer?.enrollmentComplete === true &&
    (callerData.status as string | undefined) === 'active'
  );
}

export { isAdmin };

/**
 * The §7.4 anti-hijack pin, shared by BOTH write paths (doPostTask on every
 * pair, doUpdateTask on ADDED pairs only): each pair must live under the
 * CALLER'S OWN `do-photos/{uid}/` prefix — uid match first (a mismatch is a
 * hijack attempt: permission-denied), then object existence (a missing
 * object usually means the stripper hasn't republished yet — the wizard's
 * retry state: failed-precondition, reason 'photo_not_ready').
 *
 * Shape (charset, length, no path traversal) is already bounded by
 * do-core's validateTaskPhotos — run that FIRST; this helper only decides
 * ownership and existence.
 */
export async function assertPhotosOwnedByCaller(
  photos: { uid: string; photoId: string }[],
  callerUid: string,
): Promise<void> {
  for (const pair of photos) {
    if (pair.uid !== callerUid) {
      throw new HttpsError(
        'permission-denied',
        'Photos must be uploaded by the caller',
        { reason: 'photo_not_owned' },
      );
    }
  }
  const bucket = getDefaultBucket();
  for (const pair of photos) {
    const [exists] = await bucket
      .file(photoObjectPath(pair.uid, pair.photoId))
      .exists();
    if (!exists) {
      throw new HttpsError(
        'failed-precondition',
        'Photo is not ready yet — still processing, or never uploaded',
        { reason: 'photo_not_ready', photoId: pair.photoId },
      );
    }
  }
}

/** Read a task or throw not-found. */
export async function getTaskOrThrow(
  taskId: unknown,
): Promise<{ ref: FirebaseFirestore.DocumentReference; data: TaskDoc }> {
  if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 128) {
    throw new HttpsError('invalid-argument', 'taskId is required');
  }
  const ref = db.collection('doTasks').doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Task not found');
  }
  return { ref, data: snap.data() as TaskDoc };
}
