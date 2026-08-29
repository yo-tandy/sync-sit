import { HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import type { Firestore } from 'firebase-admin/firestore';
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

/** Structural bucket type — avoids a direct @google-cloud/storage import
 *  (transitive dep; firebase-admin/storage re-exports the instance type). */
export type StorageBucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

export interface TaskCascadeStats {
  offersDeleted: number;
  photoObjectsDeleted: number;
}

/**
 * Delete one task with its offers and its photo objects — §11.4's cascade,
 * shared by the daily sweep (`runDoSweepTasks`, three retention paths) and
 * `doAdminDeleteTask` (PR10). ONE implementation on purpose: an admin delete
 * that dropped the task doc but left `taskOffers` rows and `do-photos`
 * objects behind would leave exactly the orphans §11.4 exists to prevent,
 * and two copies of this logic would drift the moment either grew a step.
 *
 * Order and the two guards are load-bearing:
 * - Offers first, EVERY status: the task is the reason the offer exists, and
 *   inspecting a deleted task's offers is not a supported surface (§11.4
 *   retention). Chunked below Firestore's 500-writes-per-batch cap —
 *   `DO_OFFER_MAX_PER_TASK` caps LIVE offers only, so a long-lived task can
 *   hold arbitrarily many withdrawn/declined ones.
 * - Task doc BEFORE its photo objects, so the still-referenced check below
 *   never counts the task being deleted.
 * - Photo objects are NOT deleted blindly: nothing dedupes `{uid, photoId}`
 *   pairs across tasks (both write paths accept the same own-prefix pair on
 *   two tasks), so an unconditional delete would 404 a still-open sibling
 *   task's photo with no way to re-attach — only the stripper writes the
 *   final prefix. A pair another task still references is left for the
 *   sweep's orphan pass to collect once the LAST referencing task is gone.
 *   `ignoreNotFound` so a re-run after a partial failure does not throw on
 *   the half that already succeeded.
 */
export async function deleteTaskCascade(
  firestore: Firestore,
  bucket: StorageBucket,
  taskRef: FirebaseFirestore.DocumentReference,
  task: TaskDoc,
  // Accumulated into as each step commits, not assembled at the end, so a
  // caller that catches a mid-cascade throw still sees what actually
  // happened. The sweep's poison-pill isolation reads these numbers on
  // exactly the runs where something failed, which is when understating
  // them is worst.
  stats: TaskCascadeStats = { offersDeleted: 0, photoObjectsDeleted: 0 },
): Promise<TaskCascadeStats> {
  const offers = await firestore
    .collection('taskOffers')
    .where('taskId', '==', taskRef.id)
    .get();
  for (let i = 0; i < offers.docs.length; i += 400) {
    const batch = firestore.batch();
    for (const offer of offers.docs.slice(i, i + 400)) {
      batch.delete(offer.ref);
    }
    await batch.commit();
  }
  stats.offersDeleted += offers.size;

  await taskRef.delete();

  for (const pair of task.photos ?? []) {
    const stillReferenced = await firestore
      .collection('doTasks')
      .where('photos', 'array-contains', { uid: pair.uid, photoId: pair.photoId })
      .limit(1)
      .get();
    if (!stillReferenced.empty) continue;
    await bucket
      .file(photoObjectPath(pair.uid, pair.photoId))
      .delete({ ignoreNotFound: true });
    stats.photoObjectsDeleted += 1;
  }

  return stats;
}

/**
 * Charset-bound a caller-supplied taskId BEFORE it reaches `.doc()`: the
 * Admin SDK treats `/` in a document path as a segment separator, so a
 * slashed id either throws synchronously (odd segment count → surfaces as
 * `internal` instead of `invalid-argument`) or silently addresses a doc in
 * an arbitrary subcollection under doTasks. Firestore auto-ids are
 * `[A-Za-z0-9]{20}`, so the shared safe-id charset fits exactly.
 */
export function validTaskId(taskId: unknown): string {
  if (typeof taskId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(taskId)) {
    throw new HttpsError('invalid-argument', 'taskId is required');
  }
  return taskId;
}

/** Read a task or throw not-found. */
export async function getTaskOrThrow(
  taskId: unknown,
): Promise<{ ref: FirebaseFirestore.DocumentReference; data: TaskDoc }> {
  const ref = db.collection('doTasks').doc(validTaskId(taskId));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Task not found');
  }
  return { ref, data: snap.data() as TaskDoc };
}
