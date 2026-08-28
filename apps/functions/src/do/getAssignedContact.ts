import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getContact, getParentProfile, type User } from '@ejm/shared-core';
import { DO_CONTACT_GRACE_DAYS, type OfferDoc, type TaskDoc } from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { callerFamilyId, validTaskId } from './taskAccess.js';
import { loadActiveCaller, tsMillis } from './offerAccess.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `doGetAssignedContact` (decision 16; plan §6.4, §8): the two-way
 * post-acceptance contact reveal, served LIVE at call time and never
 * persisted — post-acceptance contact edits are always reflected, and no
 * second stored copy of the family's address exists anywhere in sync-do
 * (§11.4).
 *
 * Standing is asserted against the ACCEPTED offer — the authorization
 * anchor, already scoped to exactly the two parties plus admin — and the
 * task's state:
 * - caller is the accepted offer's doer, OR a member of its family;
 * - task is `assigned` or `completed` — or `cancelled` within
 *   `DO_CONTACT_GRACE_DAYS = 7` of `cancelledAt`: cancellation does not cut
 *   the line dead (either side can cancel the morning of, and there is no
 *   snapshot to fall back on), so the callable keeps serving the pair long
 *   enough to coordinate the aftermath, then refuses. The 30-day
 *   cancelled-task sweep deletes the offer doc and is the hard stop.
 *
 * Both halves come back in one call:
 * - the FAMILY side from the family doc (address) plus its parents' user
 *   docs (names, email, phone/whatsapp from profiles.parent — the
 *   getParentContacts shape: the family doc itself carries no phone);
 * - the DOER side via the platform's `getContact` accessor over the
 *   student's user doc (root-canonical with profile fallback), plus name.
 */
export const doGetAssignedContact = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as Record<string, unknown>;
    const taskRef = db.collection('doTasks').doc(validTaskId(data.taskId));

    const callerData = await loadActiveCaller(uid);
    const familyId = callerFamilyId(callerData);

    const taskSnap = await taskRef.get();
    if (!taskSnap.exists) {
      throw new HttpsError('not-found', 'Task not found');
    }
    const task = taskSnap.data() as TaskDoc;
    if (!task.assignedOfferId) {
      throw new HttpsError(
        'failed-precondition',
        'This task has no assignment',
        { reason: 'not_assigned' },
      );
    }

    // The accepted offer is the authorization anchor (§6.4): standing is
    // proven against IT, not the task's denormalized fields.
    const offerSnap = await db
      .collection('taskOffers')
      .doc(task.assignedOfferId)
      .get();
    if (!offerSnap.exists) {
      // Past the sweep's hard stop (or inconsistent data): nothing to
      // anchor standing on — refuse.
      throw new HttpsError('not-found', 'Assignment record not found');
    }
    const offer = offerSnap.data() as OfferDoc;
    if (offer.status !== 'accepted') {
      throw new HttpsError(
        'failed-precondition',
        'This task has no accepted offer',
        { reason: 'not_assigned' },
      );
    }
    const isAssignedDoer = uid === offer.doerUserId;
    const isOwnerFamily = familyId !== null && familyId === offer.familyId;
    if (!isAssignedDoer && !isOwnerFamily) {
      throw new HttpsError(
        'permission-denied',
        'Only the assigned student or the task family can view contact details',
      );
    }

    // Task-state gate: assigned / completed always; cancelled only inside
    // the §6.4 aftermath grace.
    if (task.status === 'cancelled') {
      const cancelledMs = tsMillis(task.cancelledAt);
      if (
        cancelledMs === 0 ||
        Date.now() > cancelledMs + DO_CONTACT_GRACE_DAYS * DAY_MS
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Contact details are no longer available for this cancelled task',
          { reason: 'grace_elapsed' },
        );
      }
    } else if (task.status !== 'assigned' && task.status !== 'completed') {
      throw new HttpsError(
        'failed-precondition',
        'Contact details are available once the task is assigned',
        { reason: 'not_assigned' },
      );
    }

    // ── Family side: address from the family doc, parent channels from the
    // parents' user docs — all read live, nothing persisted. ──
    const familySnap = await db
      .collection('families')
      .doc(offer.familyId)
      .get();
    const familyData = (familySnap.data() ?? {}) as Record<string, unknown>;
    const parentIds = Array.isArray(familyData.parentIds)
      ? (familyData.parentIds as string[])
      : [];
    const parents: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      whatsapp?: string;
    }[] = [];
    for (const pid of parentIds) {
      const pSnap = await db.collection('users').doc(pid).get();
      if (!pSnap.exists) continue;
      const p = pSnap.data()!;
      const parent = getParentProfile(p as User);
      parents.push({
        firstName: (p.firstName as string) || '',
        lastName: (p.lastName as string) || '',
        email: (p.email as string) || '',
        ...(parent?.phone && { phone: parent.phone }),
        ...(parent?.whatsapp && { whatsapp: parent.whatsapp }),
      });
    }

    // ── Doer side: the platform's canonical contact resolution. ──
    const doerSnap = await db.collection('users').doc(offer.doerUserId).get();
    const doerData = (doerSnap.data() ?? {}) as Record<string, unknown>;
    const doerContact = getContact(doerData as unknown as User);

    return {
      taskId: taskRef.id,
      family: {
        familyName: (familyData.familyName as string) || '',
        address: (familyData.address as string) || '',
        parents,
      },
      doer: {
        firstName: (doerData.firstName as string) || '',
        lastName: (doerData.lastName as string) || '',
        contactEmail: doerContact.contactEmail,
        contactPhone: doerContact.contactPhone,
        whatsapp: doerContact.whatsapp,
      },
    };
  },
);
