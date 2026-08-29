import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  computeTaskExpiresAt,
  validateSuggestedBudget,
  validateTaskDescription,
  validateTaskPhotos,
  type TaskDoc,
} from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import {
  assertPhotosOwnedByCaller,
  callerFamilyId,
  getTaskOrThrow,
} from './taskAccess.js';
import { extractTimingFields, type StoredTimingFields } from './taskInput.js';
import { OFFER_LIVE_STATUSES } from './offerAccess.js';
import { notifyDoSafely, sendDoNotificationToUser } from './notify.js';
import { buildTaskUpdated } from './notifyContent.js';

const TIMING_KEYS = [
  'timing',
  'date',
  'startTime',
  'endTime',
  'dueDate',
  'startDate',
  'endDate',
  'cadence',
] as const;

/**
 * `doUpdateTask` (plan §8, §6.3, §7.4): the owner family edits an OPEN task
 * — description, photos, suggested budget and/or the timing group, exactly
 * the §8 row's field list. Every edit recomputes `expiresAt` server-side,
 * which is how an `ongoing` task renews (§6.3: "keeping a standing post
 * alive is one tap on its own page — no dedicated renew callable"); an
 * empty payload is therefore legal and IS the renew tap.
 *
 * Photos: the §7.4 caller-prefix check runs on ADDED pairs only — existing
 * `{uid, photoId}` entries pass through untouched, since they were verified
 * at their own add time and may belong to the OTHER parent of the family;
 * re-checking them against the current caller's prefix would wrongly strip
 * a co-parent's photos (§8).
 */
export const doUpdateTask = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as Record<string, unknown>;
    const now = new Date();

    // ── Input validation for the SUPPLIED fields (absent = leave alone) ──
    if (data.description !== undefined) {
      const err = validateTaskDescription(data.description);
      if (err) throw new HttpsError('invalid-argument', err);
    }
    if (data.suggestedBudget !== undefined) {
      const err = validateSuggestedBudget(data.suggestedBudget);
      if (err) throw new HttpsError('invalid-argument', err);
    }
    if (data.photos !== undefined) {
      const err = validateTaskPhotos(data.photos);
      if (err) throw new HttpsError('invalid-argument', err);
    }
    // The timing group updates WHOLE or not at all (§4.1's discriminant —
    // a partial group could switch models while orphan fields survive).
    let newTiming: StoredTimingFields | null = null;
    if (data.timing !== undefined) {
      newTiming = extractTimingFields(data, now);
    } else {
      for (const key of TIMING_KEYS) {
        if (data[key] !== undefined) {
          throw new HttpsError(
            'invalid-argument',
            'timing fields must be updated as a whole group, including timing',
          );
        }
      }
    }

    // ── Owner gate + the photo diff (pre-transaction read; re-asserted
    // inside the transaction below) ──
    const { ref, data: task } = await getTaskOrThrow(data.taskId);
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerData = (callerDoc.data() ?? {}) as Record<string, unknown>;
    if (
      (callerData.status as string | undefined) !== 'active' ||
      callerFamilyId(callerData) !== task.familyId
    ) {
      throw new HttpsError('permission-denied', 'Only the owner family can edit a task');
    }
    if (task.status !== 'open') {
      throw new HttpsError(
        'failed-precondition',
        'Only open tasks can be edited',
        { reason: 'not_open' },
      );
    }

    // ── §7.4 anti-hijack on ADDED pairs only (see docstring). Storage
    // lookups cannot run inside the transaction; the tx below re-checks
    // that no pair it writes escaped this verification. ──
    const pairKey = (p: { uid: string; photoId: string }) => `${p.uid}/${p.photoId}`;
    const verifiedAdds = new Set<string>();
    if (data.photos !== undefined) {
      const nextPhotos = data.photos as { uid: string; photoId: string }[];
      const existing = new Set((task.photos ?? []).map(pairKey));
      const added = nextPhotos.filter((p) => !existing.has(pairKey(p)));
      await assertPhotosOwnedByCaller(added, uid);
      for (const p of added) verifiedAdds.add(pairKey(p));
    }

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Task not found');
      }
      const current = snap.data() as TaskDoc;
      if (current.status !== 'open') {
        throw new HttpsError(
          'failed-precondition',
          'Only open tasks can be edited',
          { reason: 'not_open' },
        );
      }
      // Race guard: if a concurrent edit (the co-parent) changed the photo
      // array between our read and this transaction, a pair we classified
      // as "existing" may in fact be new relative to the CURRENT array. No
      // unverified pair may ride through — abort so the client retries
      // against fresh state.
      if (data.photos !== undefined) {
        const currentKeys = new Set((current.photos ?? []).map(pairKey));
        for (const p of data.photos as { uid: string; photoId: string }[]) {
          const key = pairKey(p);
          if (!currentKeys.has(key) && !verifiedAdds.has(key)) {
            throw new HttpsError(
              'aborted',
              'The task changed while editing — reload and retry',
            );
          }
        }
      }

      // expiresAt is recomputed on EVERY edit from the (possibly updated)
      // timing group — for `ongoing` that is now + 14d again (the renewal);
      // for dated tasks it recomputes to the same instant unless the dates
      // changed.
      const timingForExpiry: StoredTimingFields = newTiming ?? {
        timing: current.timing,
        date: current.date,
        startTime: current.startTime,
        endTime: current.endTime,
        dueDate: current.dueDate,
        startDate: current.startDate,
        endDate: current.endDate,
        cadence: current.cadence,
      };
      const update: Record<string, unknown> = {
        updatedAt: now,
        expiresAt: computeTaskExpiresAt(timingForExpiry, now),
      };
      if (data.description !== undefined) {
        update.description = (data.description as string).trim();
      }
      if (data.suggestedBudget !== undefined) {
        update.suggestedBudget = data.suggestedBudget;
      }
      if (data.photos !== undefined) {
        update.photos = (data.photos as { uid: string; photoId: string }[]).map(
          ({ uid: photoUid, photoId }) => ({ uid: photoUid, photoId }),
        );
      }
      if (newTiming) {
        Object.assign(update, newTiming);
      }
      tx.update(ref, update);
    });

    // Notify students with live offers that the terms changed (§8's row,
    // §10, §13 PR9) — post-commit, failures swallowed. Both live statuses:
    // a `pending_guardian` offer belongs to a student who can see it in "My
    // offers" and cares that the terms moved (nothing here reaches the
    // hiring family, so §6.2 is untouched). The empty-payload RENEW tap
    // (§6.3: an ongoing task's "keep alive" is an edit with no fields) is
    // deliberately silent — nothing the offerer sees changed.
    const changedSomething =
      data.description !== undefined ||
      data.suggestedBudget !== undefined ||
      data.photos !== undefined ||
      newTiming !== null;
    if (changedSomething) {
      await notifyDoSafely('updateTask', async () => {
        const liveOffers = await db
          .collection('taskOffers')
          .where('taskId', '==', ref.id)
          .where('status', 'in', [...OFFER_LIVE_STATUSES])
          .get();
        for (const offerSnap of liveOffers.docs) {
          const offererUid = offerSnap.data().doerUserId as string | undefined;
          if (!offererUid) continue;
          await sendDoNotificationToUser({
            recipientUserId: offererUid,
            type: 'task_updated',
            prefCategory: 'newRequest',
            content: (lang) =>
              buildTaskUpdated(lang, { taskTitle: task.title, taskId: ref.id }),
            data: { taskId: ref.id },
          });
        }
      });
    }

    await writeUserActivity(uid, 'do.task_updated', {
      taskId: ref.id,
      familyId: task.familyId,
    });

    return { taskId: ref.id };
  },
);
