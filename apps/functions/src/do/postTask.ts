import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { resolveAreaLabel } from '@ejm/shared-core';
import {
  DO_TASK_MAX_ACTIVE,
  computeTaskExpiresAt,
  validateCategoryPair,
  validateEstimatedHours,
  validateSuggestedBudget,
  validateTaskDescription,
  validateTaskPhotos,
  validateTaskTitle,
  type TaskCategory,
  type AdultPresence,
} from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import {
  assertPhotosOwnedByCaller,
  loadVerifiedFamilyCaller,
} from './taskAccess.js';
import { extractTimingFields } from './taskInput.js';

/**
 * `doPostTask` (plan §8, §4.1, §6.3, §7.4, §11.1): a verified family
 * publishes a task to the board.
 *
 * - Verified-family gate: `verification.isFullyVerified`, the §11.1
 *   PORTABLE check — one family, one approval, three apps; never a per-app
 *   verification state.
 * - Validates with the do-core validators (shared bounds, so the wizard
 *   pre-empts every error), including `validateTaskTimingNotPast`.
 * - `areaLabel` is REQUIRED (decision 17): when the family's postcode/city
 *   resolves no label the callable refuses (`failed-precondition`,
 *   `reason: 'address_required'`) and the wizard routes the parent to
 *   complete their address first.
 * - `expiresAt` is server-computed (§6.3, do-core `computeTaskExpiresAt`) —
 *   never client-supplied.
 * - `DO_TASK_MAX_ACTIVE` is enforced against the family's OPEN tasks inside
 *   the create transaction, so two concurrent posts cannot both pass the
 *   count (the publishSearch precedent).
 * - Photos: each submitted `{uid, photoId}` pair must exist under the
 *   CALLER'S OWN `do-photos/{uid}/` prefix (§7.4's anti-hijack pin — nobody
 *   can attach someone else's photo; the stored uid is what lets
 *   `doGetTaskPhotoUrl` reconstruct the path later).
 */
export const doPostTask = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as Record<string, unknown>;
    const now = new Date();

    // ── Input validation (do-core validators; §8 house style) ──
    for (const err of [
      validateCategoryPair(data.category, data.subCategory),
      validateTaskTitle(data.title),
      validateTaskDescription(data.description),
      validateTaskPhotos(data.photos ?? []),
      validateEstimatedHours(data.estimatedHours ?? null),
      validateSuggestedBudget(data.suggestedBudget ?? null),
    ]) {
      if (err) throw new HttpsError('invalid-argument', err);
    }
    const timingFields = extractTimingFields(data, now);
    if (
      data.adultPresent !== 'yes' &&
      data.adultPresent !== 'no' &&
      data.adultPresent !== 'partly'
    ) {
      throw new HttpsError(
        'invalid-argument',
        'adultPresent must be yes, no or partly',
      );
    }
    if (
      data.toolsProvided !== undefined &&
      data.toolsProvided !== null &&
      typeof data.toolsProvided !== 'boolean'
    ) {
      throw new HttpsError('invalid-argument', 'toolsProvided must be a boolean or null');
    }
    if (typeof data.transportNeeded !== 'boolean') {
      throw new HttpsError('invalid-argument', 'transportNeeded must be a boolean');
    }
    const photos = (data.photos ?? []) as { uid: string; photoId: string }[];

    // ── Caller gate: parent with a fully-verified family (§11.1) ──
    const { familyId, familyData } = await loadVerifiedFamilyCaller(uid);

    // ── Area label — REQUIRED (decision 17). The only location signal the
    // board ever carries (§11.2): label, never address or latLng. ──
    const areaLabel = resolveAreaLabel({
      postcode: (familyData.postcode as string | undefined) ?? undefined,
      city: (familyData.city as string | undefined) ?? undefined,
    });
    if (!areaLabel) {
      throw new HttpsError(
        'failed-precondition',
        'Complete your address before posting: the task must show your area',
        { reason: 'address_required' },
      );
    }

    // ── Photo ownership (§7.4 anti-hijack) — after the family gate so an
    // unauthorized caller never drives Storage lookups. ──
    await assertPhotosOwnedByCaller(photos, uid);

    const expiresAt = computeTaskExpiresAt(timingFields, now);

    const ref = db.collection('doTasks').doc();
    const taskDoc = {
      taskId: ref.id,
      familyId,
      createdByUserId: uid,
      familyName: (familyData.familyName as string) || '',
      areaLabel,
      category: data.category as TaskCategory,
      subCategory: data.subCategory as string,
      title: (data.title as string).trim(),
      description: (data.description as string).trim(),
      photos: photos.map(({ uid: photoUid, photoId }) => ({ uid: photoUid, photoId })),
      ...timingFields,
      estimatedHours: (data.estimatedHours as number | undefined) ?? null,
      suggestedBudget: (data.suggestedBudget as number | undefined) ?? null,
      adultPresent: data.adultPresent as AdultPresence,
      toolsProvided: (data.toolsProvided as boolean | undefined) ?? null,
      transportNeeded: data.transportNeeded,
      status: 'open' as const,
      offerCount: 0,
      assignedUserId: null,
      assignedOfferId: null,
      assignedAt: null,
      agreedPrice: null,
      doerMarkedDoneAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    };

    // ── Cap check + create in ONE transaction (DO_TASK_MAX_ACTIVE against
    // the family's OPEN tasks): two concurrent posts cannot both pass the
    // count. Equality-only query — served by index merging, no composite. ──
    await db.runTransaction(async (tx) => {
      const openSnap = await tx.get(
        db
          .collection('doTasks')
          .where('familyId', '==', familyId)
          .where('status', '==', 'open'),
      );
      // Expiry filtered in code, the publishSearch precedent: an
      // expired-but-unswept open task (the sweep runs daily) must not hold
      // a family's slot hostage until 03:00.
      const activeCount = openSnap.docs.filter((d) => {
        const exp = d.data().expiresAt;
        const expMs = exp?.toMillis ? exp.toMillis() : exp?.toDate ? exp.toDate().getTime() : 0;
        return expMs > now.getTime();
      }).length;
      if (activeCount >= DO_TASK_MAX_ACTIVE) {
        throw new HttpsError(
          'resource-exhausted',
          `A family can have at most ${DO_TASK_MAX_ACTIVE} open tasks`,
          { reason: 'task_cap' },
        );
      }
      tx.set(ref, taskDoc);
    });

    await writeUserActivity(uid, 'do.task_posted', {
      taskId: ref.id,
      familyId,
      category: taskDoc.category,
      subCategory: taskDoc.subCategory,
    });

    return { taskId: ref.id };
  },
);
