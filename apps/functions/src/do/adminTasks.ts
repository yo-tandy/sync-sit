import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { TaskDoc, OfferDoc } from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from '../admin/verifyAdmin.js';
import { writeAuditLog } from '../admin/writeAuditLog.js';
import {
  deleteTaskCascade,
  getDefaultBucket,
  getTaskOrThrow,
  validTaskId,
} from './taskAccess.js';

/**
 * The sync-do admin surface (plan §8's two rows, §9.4). Admin lives ONLY in
 * `apps/web` — sync-do grows no admin tree of its own (decision 20 keeps the
 * sit/study apps free of sync-do MEMBER entry points; an admin tab is
 * tooling, not a member surface), so these two callables back a Tasks tab in
 * the existing panel.
 *
 * Both go through the Admin SDK behind `verifyAdmin`, which is why PR3's
 * `firestore.rules` needs no admin disjunct on `doTasks`/`taskOffers` and
 * this PR does not touch it: admin reads never take the client path.
 */

/** Admin list page size, and the widened window an in-memory search scans. */
const ADMIN_TASKS_LIMIT = 50;
const ADMIN_TASKS_SEARCH_WINDOW = 500;

interface AdminListTasksInput {
  searchQuery?: string;
  categoryFilter?: string;
  statusFilter?: string;
  familyIdFilter?: string;
  /** Detail mode: return this one task plus ALL of its offers. */
  taskId?: string;
  limit?: number;
  startAfterId?: string;
}

/** The wire row — an explicit projection, not a doc spread. */
function projectTask(doc: FirebaseFirestore.DocumentSnapshot) {
  const t = doc.data() as TaskDoc;
  return {
    id: doc.id,
    familyId: t.familyId ?? '',
    familyName: t.familyName ?? '',
    createdByUserId: t.createdByUserId ?? '',
    areaLabel: t.areaLabel ?? '',
    category: t.category ?? '',
    subCategory: t.subCategory ?? '',
    title: t.title ?? '',
    description: t.description ?? '',
    status: t.status ?? '',
    timing: t.timing ?? '',
    offerCount: t.offerCount ?? 0,
    photoCount: (t.photos ?? []).length,
    suggestedBudget: t.suggestedBudget ?? null,
    agreedPrice: t.agreedPrice ?? null,
    assignedUserId: t.assignedUserId ?? null,
    adultPresent: t.adultPresent ?? null,
    createdAt: t.createdAt ?? null,
    expiresAt: t.expiresAt ?? null,
    completedAt: t.completedAt ?? null,
    cancelledAt: t.cancelledAt ?? null,
    cancelledBy: t.cancelledBy ?? null,
  };
}

/**
 * Offers as admin sees them. `message` and the +1 `helper` are deliberately
 * INCLUDED: §11.5 says admin "can see the task record and the agreed price if
 * asked to help two members reconstruct what was agreed", and the helper is
 * the §11.3 disclosure a family may later query. Nothing contact-shaped
 * exists on an offer to leak (decision 16 keeps contact off the document
 * entirely), so this projection cannot widen the contact surface.
 */
function projectOffer(doc: FirebaseFirestore.DocumentSnapshot) {
  const o = doc.data() as OfferDoc;
  return {
    id: doc.id,
    taskId: o.taskId ?? '',
    doerUserId: o.doerUserId ?? '',
    doerFirstName: o.doerFirstName ?? '',
    price: o.price ?? null,
    priceBasis: o.priceBasis ?? null,
    message: o.message ?? '',
    helper: o.helper ?? null,
    status: o.status ?? '',
    guardianRequired: o.guardian?.required ?? false,
    declinedReason: o.declinedReason ?? null,
    createdAt: o.createdAt ?? null,
    updatedAt: o.updatedAt ?? null,
  };
}

/** Sort key for a `taskOffers` doc, tolerant of a missing timestamp. */
function offerMillis(doc: FirebaseFirestore.DocumentSnapshot): number {
  const raw = doc.data()?.createdAt;
  return typeof raw?.toMillis === 'function' ? raw.toMillis() : 0;
}

/**
 * `doAdminListTasks` (plan §8) — the Tasks tab's read.
 *
 * Two modes, one callable because §8 budgets exactly two admin rows:
 * - LIST: filter by category / status / familyId, newest first, cursor-paged.
 * - DETAIL (`taskId` given): that one task plus every offer on it, any
 *   status. This is the "view a task's offers" half of §9.4, and it is the
 *   only read path to a `pending_guardian` offer outside the guardian's own
 *   queue — admin holds it because the guardian queue is Admin-SDK-served
 *   (§7.3) and a support question about a stuck offer is unanswerable
 *   otherwise.
 *
 * Filters are Firestore predicates (the §7.3 composites cover every
 * combination — see `firestore.indexes.json`); free-text `searchQuery` is
 * in-memory over a widened window, exactly as `listUsers`/`listFamilies` do
 * it, because Firestore has no substring operator and the community is
 * small.
 */
export const doAdminListTasks = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    await verifyAdmin(request.auth.uid);

    const {
      searchQuery,
      categoryFilter,
      statusFilter,
      familyIdFilter,
      taskId,
      limit = ADMIN_TASKS_LIMIT,
      startAfterId,
    } = (request.data ?? {}) as AdminListTasksInput;

    // ── Detail mode: one task + all of its offers ──
    if (taskId) {
      const { ref } = await getTaskOrThrow(taskId);
      const [taskSnap, offersSnap] = await Promise.all([
        ref.get(),
        db.collection('taskOffers').where('taskId', '==', ref.id).get(),
      ]);
      return {
        tasks: [projectTask(taskSnap)],
        // Ordered in memory: an unfiltered (taskId, createdAt) order would
        // need a composite no other query asks for, and a single task's
        // offers are bounded small. `toMillis` guards a doc written by a
        // test or a repair without a server timestamp.
        offers: offersSnap.docs
          .sort((a, b) => offerMillis(a) - offerMillis(b))
          .map(projectOffer),
        hasMore: false,
      };
    }

    // ── List mode ──
    let query: FirebaseFirestore.Query = db.collection('doTasks');
    if (statusFilter) query = query.where('status', '==', statusFilter);
    if (categoryFilter) query = query.where('category', '==', categoryFilter);
    if (familyIdFilter) query = query.where('familyId', '==', familyIdFilter);
    query = query.orderBy('createdAt', 'desc');

    if (startAfterId) {
      const cursor = await db.collection('doTasks').doc(validTaskId(startAfterId)).get();
      if (cursor.exists) query = query.startAfter(cursor);
    }

    // A widened window when the in-memory search runs, so a match beyond the
    // first page is still findable — the listUsers precedent. `hasMore` is
    // computed with the +1 probe on the window actually fetched.
    const pageLimit = Math.min(Math.max(limit, 1), ADMIN_TASKS_LIMIT);
    const fetchLimit = searchQuery ? ADMIN_TASKS_SEARCH_WINDOW : pageLimit + 1;
    const snapshot = await query.limit(fetchLimit).get();

    let tasks = snapshot.docs.map(projectTask);

    if (searchQuery) {
      const needle = searchQuery.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(needle) ||
          t.familyName.toLowerCase().includes(needle) ||
          t.areaLabel.toLowerCase().includes(needle) ||
          t.id.toLowerCase() === needle,
      );
    }

    const hasMore = tasks.length > pageLimit;

    return { tasks: tasks.slice(0, pageLimit), offers: [], hasMore };
  },
);

interface AdminDeleteTaskInput {
  taskId: string;
}

/**
 * `doAdminDeleteTask` (plan §8) — hard delete + audit.
 *
 * Runs the SAME `deleteTaskCascade` the retention sweep runs, so an admin
 * removal leaves no `taskOffers` rows and no orphaned `do-photos` objects
 * (§11.4). It is a hard delete, not a status flip: §8's row says "hard
 * delete", and the sit precedent (`deleteAppointment`) removes the document
 * too. No notification is sent — PR9's types cover member-initiated
 * transitions, and inventing an admin-removal notice is a product call this
 * PR does not own; the audit entry is the record.
 */
export const doAdminDeleteTask = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    await verifyAdmin(request.auth.uid);

    const { taskId } = (request.data ?? {}) as AdminDeleteTaskInput;
    const { ref, data: task } = await getTaskOrThrow(taskId);

    const stats = await deleteTaskCascade(db, getDefaultBucket(), ref, task);

    // `writeAuditLog` rather than the do callables' `writeUserActivity`
    // wrapper: this is an ADMIN action on someone else's data, so it needs
    // the `targetUserId` slot the wrapper does not expose (the
    // `deleteAppointment` precedent). Same `auditLogs` collection, same
    // `do.`-prefixed action namespace as the member-side entries.
    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'do.admin_delete_task',
      targetUserId: task.createdByUserId,
      details: {
        taskId: ref.id,
        familyId: task.familyId,
        status: task.status,
        category: task.category,
        assignedUserId: task.assignedUserId ?? null,
        offersDeleted: stats.offersDeleted,
        photoObjectsDeleted: stats.photoObjectsDeleted,
      },
    });

    return { success: true, taskId: ref.id, ...stats };
  },
);
