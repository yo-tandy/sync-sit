import { getStorage } from 'firebase-admin/storage';
import { db } from '../config/firebase.js';

/**
 * The sync-do halves of `exportUserData` and `deleteUser` (plan §11.4).
 *
 * Why a module rather than inline blocks like the guardian and `references`
 * steps: the two callables need the SAME set of queries in mirror image (a
 * family's tasks and a doer's offers), and the photo half needs three
 * operations — prefix erasure, path enumeration, and the dangling-reference
 * scrub — that would otherwise be copied into both files.
 *
 * Deliberately string-keyed, no `@ejm/do-core` import: `@ejm/shared-functions`
 * does not depend on the leaf do package, and the `references` precedent
 * (`referenceKeys.ts`) shows the house answer — plain collection and field
 * names, with the contract stated in the docblock. The field names below are
 * `TaskDoc` / `OfferDoc` as shipped by PR1; the storage paths are §7.4's.
 */

/** `doTasks` — the family's published demand (§4.1). */
export const DO_TASKS_COLLECTION = 'doTasks';
/** `taskOffers` — the student's offer, `${taskId}_${doerUserId}` (§4.2). */
export const DO_OFFERS_COLLECTION = 'taskOffers';

/** §7.4's quarantine prefix — the client's only upload path. */
export const DO_UPLOADS_PREFIX = 'do-uploads/';
/** §7.4's final prefix — stripper output, callable-signed reads only. */
export const DO_PHOTOS_PREFIX = 'do-photos/';

/** The §7.4 object path a stored `{uid, photoId}` pair denotes. */
export function doPhotoObjectPath(uid: string, photoId: string): string {
  return `${DO_PHOTOS_PREFIX}${uid}/${photoId}`;
}

export interface DoPhotoRef {
  uid: string;
  photoId: string;
}

/** A `photos[]` array off a raw task doc, defensively narrowed. */
function photoPairs(data: FirebaseFirestore.DocumentData): DoPhotoRef[] {
  const raw = data.photos;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is DoPhotoRef =>
      !!p && typeof p.uid === 'string' && typeof p.photoId === 'string',
  );
}

export interface DoUserData {
  /** Tasks the user's family posted, or the user personally created. */
  tasks: Record<string, unknown>[];
  /** Offers the user made as a doer, plus offers made to their family. */
  offers: Record<string, unknown>[];
  /**
   * Every `do-photos` object path referenced from the tasks above (§11.4:
   * "the export enumerates the photo paths referenced from the user's
   * tasks"). Paths, not bytes — the export payload is JSON, and the objects
   * themselves are served by `doGetTaskPhotoUrl` / `doGetOwnPhotoUrl`.
   */
  photoPaths: string[];
}

/**
 * Collect the sync-do data of one user for `exportUserData`, BOTH sides:
 *
 * - the FAMILY side — every task of their family (`familyId`), which is the
 *   same reasoning that gives family appointments and family-submitted
 *   endorsements to a parent's export: a task is family data and either
 *   parent may have authored it. `createdByUserId` is queried too, so a user
 *   who created tasks before leaving a family still exports them.
 * - the DOER side — every offer they submitted (`doerUserId`), including the
 *   offer that became an assignment (an accepted offer is the record of the
 *   engagement, §8's `doCancelTask` row).
 * - the family's INBOUND offers (`familyId` on the offer, denormalized from
 *   the task), so a parent's export shows what was offered on their tasks —
 *   this is data they already read in the app.
 *
 * Note what an offer carries and the export therefore surfaces: the §11.3
 * +1 helper's first name, last name and age. The helper has no account, so
 * this is the ONLY route by which their data reaches a subject-access
 * request at all — via the doer whose offer names them (§11.4 states the
 * helper has no GDPR path of their own; retention bounds it at 6 months).
 */
export async function collectDoUserData(
  targetUserId: string,
  familyId: string | null,
): Promise<DoUserData> {
  const empty = { docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] };
  const [familyTasksSnap, createdTasksSnap, doerOffersSnap, familyOffersSnap] =
    await Promise.all([
      familyId
        ? db.collection(DO_TASKS_COLLECTION).where('familyId', '==', familyId).get()
        : Promise.resolve(empty as any),
      db
        .collection(DO_TASKS_COLLECTION)
        .where('createdByUserId', '==', targetUserId)
        .get(),
      db.collection(DO_OFFERS_COLLECTION).where('doerUserId', '==', targetUserId).get(),
      familyId
        ? db.collection(DO_OFFERS_COLLECTION).where('familyId', '==', familyId).get()
        : Promise.resolve(empty as any),
    ]);

  const taskDocs = Array.from(
    new Map(
      [...familyTasksSnap.docs, ...createdTasksSnap.docs].map((doc: any) => [doc.id, doc]),
    ).values(),
  ) as FirebaseFirestore.QueryDocumentSnapshot[];

  const offers = Array.from(
    new Map(
      [...doerOffersSnap.docs, ...familyOffersSnap.docs].map((doc: any) => [
        doc.id,
        { id: doc.id, ...doc.data() },
      ]),
    ).values(),
  );

  // Deduped: the same pair may sit on two tasks (nothing dedupes pairs
  // across tasks — see the sweep's orphan pass).
  const photoPaths = Array.from(
    new Set(
      taskDocs.flatMap((doc) =>
        photoPairs(doc.data()).map((p) => doPhotoObjectPath(p.uid, p.photoId)),
      ),
    ),
  );

  return {
    tasks: taskDocs.map((doc) => ({ id: doc.id, ...doc.data() })),
    offers,
    photoPaths,
  };
}

export interface DoEraseStats {
  tasksDeleted: number;
  offersDeleted: number;
  photoObjectsDeleted: number;
  /** Live tasks whose `photos[]` lost this uid's entries (the §11.4 scrub). */
  tasksScrubbed: number;
}

/** Chunked batch delete — `deleteUser`'s own batches have no 500-op guard,
 *  and a long-lived doer can hold arbitrarily many offers. */
async function deleteAll(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<number> {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + 400)) batch.delete(doc.ref);
    await batch.commit();
  }
  return docs.length;
}

/**
 * Erase the sync-do data of one user for `deleteUser` (§11.4), in four
 * halves. Call it BEFORE the user document is deleted, and pass the same
 * `isLastParent` the appointment/family/reference steps computed.
 *
 * 1. TASKS. Family tasks go only when the LAST parent goes — a task is
 *    family data with a surviving owner otherwise, exactly like the family
 *    doc, the kids and the family's endorsements. Tasks the deleted user
 *    personally created are ALWAYS deleted: their free-text description and
 *    their photos are the deleted subject's own content. Each deleted task
 *    takes its offers with it (the cascade below).
 * 2. OFFERS. Every offer the user made as a doer is deleted outright — the
 *    substantive fields (`message`, `price`, the §11.3 helper's name and
 *    age, `doerBio`) are all doer-side personal data, so anonymizing would
 *    leave a contentless ghost, the same reasoning the `references` step
 *    records for the submitter side. Offers on a SURVIVING family's tasks
 *    are still deleted: the doer is the data subject, not the family.
 * 3. PHOTO OBJECTS. `do-photos/{uid}/**` and `do-uploads/{uid}/**` are
 *    deleted WHOLESALE, by prefix — the uid-keyed layout §7.4 chose makes
 *    "this user's images" exactly one prefix listing, and §11.4 names both
 *    prefixes explicitly. Not conditional on any task surviving: this is
 *    erasure, and a garden, a front door or a flat interior (§11.2's own
 *    premise) must not outlive the account that uploaded it.
 * 4. DANGLING-REFERENCE SCRUB. Because step 3 erases objects a CO-PARENT's
 *    still-live task may reference (`photos[]` may hold pairs from either
 *    parent — §8's `doUpdateTask` row), the deleted uid's `{uid, photoId}`
 *    entries are removed from the `photos[]` arrays of every remaining task
 *    of their family. Without this, the surviving parent's task renders
 *    broken thumbnails and `doGetTaskPhotoUrl` signs URLs for deleted
 *    objects. The scrub runs over the family's tasks AFTER step 1, so it
 *    only ever touches tasks that survived.
 */
export async function eraseDoUserData(
  targetUserId: string,
  familyId: string | null,
  isLastParent: boolean,
): Promise<DoEraseStats> {
  const stats: DoEraseStats = {
    tasksDeleted: 0,
    offersDeleted: 0,
    photoObjectsDeleted: 0,
    tasksScrubbed: 0,
  };
  const empty = { docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] };

  // ── 1. Tasks (+ their offers) ──
  const [familyTasksSnap, createdTasksSnap] = await Promise.all([
    familyId && isLastParent
      ? db.collection(DO_TASKS_COLLECTION).where('familyId', '==', familyId).get()
      : Promise.resolve(empty as any),
    db
      .collection(DO_TASKS_COLLECTION)
      .where('createdByUserId', '==', targetUserId)
      .get(),
  ]);

  const tasksToDelete = Array.from(
    new Map(
      [...familyTasksSnap.docs, ...createdTasksSnap.docs].map((doc: any) => [doc.id, doc]),
    ).values(),
  ) as FirebaseFirestore.QueryDocumentSnapshot[];

  for (const taskDoc of tasksToDelete) {
    const offers = await db
      .collection(DO_OFFERS_COLLECTION)
      .where('taskId', '==', taskDoc.id)
      .get();
    stats.offersDeleted += await deleteAll(offers.docs);
  }
  stats.tasksDeleted = await deleteAll(tasksToDelete);

  // ── 2. The doer's own offers, wherever they live ──
  const doerOffers = await db
    .collection(DO_OFFERS_COLLECTION)
    .where('doerUserId', '==', targetUserId)
    .get();
  // Skip any already removed with their task above.
  const goneTaskIds = new Set(tasksToDelete.map((d) => d.id));
  stats.offersDeleted += await deleteAll(
    doerOffers.docs.filter((d) => !goneTaskIds.has(d.data().taskId)),
  );

  // ── 3. Photo objects: both prefixes, wholesale ──
  const bucket = getStorage().bucket();
  for (const prefix of [DO_PHOTOS_PREFIX, DO_UPLOADS_PREFIX]) {
    const [files] = await bucket.getFiles({ prefix: `${prefix}${targetUserId}/` });
    for (const file of files) {
      await file.delete({ ignoreNotFound: true });
      stats.photoObjectsDeleted += 1;
    }
  }

  // ── 4. Dangling-reference scrub on the family's SURVIVING tasks ──
  if (familyId) {
    const survivors = await db
      .collection(DO_TASKS_COLLECTION)
      .where('familyId', '==', familyId)
      .get();
    const scrubbed = survivors.docs.filter((doc) =>
      photoPairs(doc.data()).some((p) => p.uid === targetUserId),
    );
    for (let i = 0; i < scrubbed.length; i += 400) {
      const batch = db.batch();
      for (const doc of scrubbed.slice(i, i + 400)) {
        batch.update(doc.ref, {
          photos: photoPairs(doc.data()).filter((p) => p.uid !== targetUserId),
          updatedAt: new Date(),
        });
      }
      await batch.commit();
    }
    stats.tasksScrubbed = scrubbed.length;
  }

  return stats;
}
