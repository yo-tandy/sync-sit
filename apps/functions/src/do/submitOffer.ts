import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  DO_OFFER_MAX_ACTIVE,
  DO_OFFER_MAX_PER_TASK,
  requiresGuardianConsent,
  validateAvailabilityNote,
  validateOfferHelper,
  validateOfferMessage,
  validatePrice,
  validatePriceBasis,
  type OfferDoc,
  type TaskDoc,
} from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { calculateAge } from '../search/ageBackstop.js';
import { toDobDate } from './dob.js';
import { validTaskId } from './taskAccess.js';
import {
  OFFER_LIVE_STATUSES,
  loadActiveCaller,
  resolveDoerPhotoUrl,
  tsMillis,
} from './offerAccess.js';
import { notifyDoFamilyParents, notifyDoSafely } from './notify.js';
import {
  buildGuardianApprovalRequested,
  buildTaskOfferReceived,
  fallbackDoerName,
} from './notifyContent.js';

/**
 * `doSubmitOffer` (plan §4.2, §6.2, §6.3, §8, §11.1): an active, enrolled
 * doer bids on an open task.
 *
 * - Deterministic id: `offerId == `${taskId}_${doerUserId}`` — "one offer per
 *   student per task" as a STRUCTURAL invariant. Finding an existing doc is
 *   handled by status, each branch pinned in §4.2 (the resurrection matrix
 *   below), never discovered ad hoc.
 * - §11.1 floor RE-check for ungoverned callers, bare age-from-DOB:
 *   supervision is revocable and the enrollment gate never re-runs, so an
 *   enrollment-only floor would not survive `revokeSupervision`. Offering is
 *   the callable chokepoint that restores sit's self-healing property — a
 *   formerly supervised young student can still browse; they cannot offer.
 * - Guardian gate (§6.2): flagged sub-category + ACTIVE guardianLinks doc →
 *   `pending_guardian` with the `guardian` map; otherwise `pending` and the
 *   field is NOT WRITTEN AT ALL — §4.2's absent-not-null contract is a
 *   rules-layer requirement (`resource.data.get('guardian', {})` defaults
 *   only for an ABSENT key; present-but-null errors the §7.2 disjunct).
 * - Ceilings, both checked INSIDE the transaction: `DO_OFFER_MAX_ACTIVE`
 *   against the caller's live offers (query), `DO_OFFER_MAX_PER_TASK`
 *   against the transactionally-maintained live `offerCount` — the §6.4
 *   write-set bound, refusal `reason: 'task_offer_cap'`.
 * - Denormalizes the two §4.2 blocks: doerFirstName/PhotoUrl/Bio (the offer
 *   card renders under the offer read rule alone) and taskTitle/Category/
 *   Timing (the "My offers" list renders terminal offers from the offer doc
 *   alone).
 */
export const doSubmitOffer = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as Record<string, unknown>;
    const now = new Date();
    const taskId = validTaskId(data.taskId);

    // ── Input validation (do-core validators; §8 house style) ──
    for (const err of [
      validatePrice(data.price),
      validatePriceBasis(data.priceBasis),
      validateOfferMessage(data.message),
      validateOfferHelper(data.helper ?? null),
      validateAvailabilityNote(data.availabilityNote ?? null),
    ]) {
      if (err) throw new HttpsError('invalid-argument', err);
    }
    // Scrub the helper to exactly the §4.2 shape (after validation — the
    // validator proved the three fields): a raw pass-through would persist
    // any extra keys the client attached (§11.3: this lands on a
    // family-readable doc).
    const rawHelper = (data.helper ?? null) as
      | { firstName: string; lastName: string; age: number }
      | null;
    const helper = rawHelper
      ? {
          firstName: rawHelper.firstName.trim(),
          lastName: rawHelper.lastName.trim(),
          age: rawHelper.age,
        }
      : null;

    // ── Caller gate (§11.1 "Offering"): active + enrollmentComplete ──
    const callerData = await loadActiveCaller(uid);
    const doerProfile = (
      (callerData.profiles ?? {}) as Record<string, Record<string, unknown> | undefined>
    ).doer;
    if (doerProfile?.enrollmentComplete !== true) {
      throw new HttpsError(
        'permission-denied',
        'Enroll as a doer before offering',
      );
    }

    // ── The §11.1 under-15 floor, RE-checked — bare age-from-DOB, same
    // shape as doEnrollDoer (never gated on the EJM email parsing). The
    // governed mirror is the only thing this callable may trust; the moment
    // it is absent the floor holds, however it got that way. A missing or
    // unparseable stored DOB on an UNGOVERNED caller fails CLOSED (the gate
    // must never no-op silently) — enrollment made the DOB mandatory, so
    // this arm is corrupted-doc defense, not a normal path. ──
    const isGoverned = !!callerData.governedBy;
    if (!isGoverned) {
      const dob = toDobDate(callerData.dateOfBirth);
      if (!dob || Number.isNaN(dob.getTime())) {
        throw new HttpsError(
          'failed-precondition',
          'Your account has no valid date of birth on file',
          { reason: 'dob_missing' },
        );
      }
      if (calculateAge(dob) < 15) {
        throw new HttpsError(
          'failed-precondition',
          'You need to be at least 15 to offer on your own.',
          { reason: 'under_15', code: 'age/under-15' },
        );
      }
    }

    // ── Guardian gate resolution (§6.2): the ACTIVE link doc is the
    // authority (its familyId is the SUPERVISING family — the student's
    // own, not the hiring family's). Read before the transaction: link
    // state is not part of the §6.4 race surface, and the gate is re-run on
    // every (re)submission — the laundering pin. ──
    let supervisingFamilyId: string | null = null;
    if (isGoverned) {
      const link = (
        await db.collection('guardianLinks').doc(uid).get()
      ).data();
      if (link && link.status === 'active') {
        supervisingFamilyId = (link.familyId as string) ?? null;
      }
    }

    const taskRef = db.collection('doTasks').doc(taskId);
    const offerRef = db.collection('taskOffers').doc(`${taskId}_${uid}`);

    let status: 'pending' | 'pending_guardian' = 'pending';
    let resurrected = false;
    let taskTitle = '';
    let taskFamilyId = '';
    await db.runTransaction(async (tx) => {
      // Reads first, then writes (the §6.4 phase rule).
      const taskSnap = await tx.get(taskRef);
      if (!taskSnap.exists) {
        throw new HttpsError('not-found', 'Task not found');
      }
      const task = taskSnap.data() as TaskDoc;
      // Task-status check BEFORE the offer doc is consulted (§4.2): a
      // declined-because-sibling_accepted / task_closed resurrection attempt
      // dies here, on the truthful error.
      if (task.status !== 'open' || tsMillis(task.expiresAt) <= now.getTime()) {
        throw new HttpsError(
          'failed-precondition',
          'This task is no longer open for offers',
          { reason: 'task_not_open' },
        );
      }

      const offerSnap = await tx.get(offerRef);
      if (offerSnap.exists) {
        const existing = offerSnap.data() as OfferDoc;
        // The §4.2 resurrection matrix, branch by branch:
        // - pending / pending_guardian / accepted → already-exists
        // - declined + family_declined → resurrect (decision 18)
        // - declined + sibling_accepted / task_closed → refused (normally
        //   unreachable past the task-status check above; kept explicit so
        //   an inconsistent doc refuses rather than resurrects)
        // - withdrawn / expired → resurrect
        if (
          existing.status === 'pending' ||
          existing.status === 'pending_guardian' ||
          existing.status === 'accepted'
        ) {
          throw new HttpsError(
            'already-exists',
            'You already have an offer on this task',
            { reason: 'offer_exists' },
          );
        }
        if (
          existing.status === 'declined' &&
          existing.declinedReason !== 'family_declined'
        ) {
          throw new HttpsError(
            'failed-precondition',
            'This task is no longer open for offers',
            { reason: 'task_not_open' },
          );
        }
        resurrected = true;
        // Fall through: the FULL submit path re-runs below — ceilings
        // re-checked, offerCount re-incremented, guardian gate re-run (no
        // laundering a flagged offer past a parent by withdraw+resubmit),
        // price/message/helper reset from the new submission.
      }

      // ── DO_OFFER_MAX_PER_TASK, against the LIVE offerCount (§6.4's
      // write-set bound — the one ceiling that is correctness, not policy).
      // Live, not lifetime: withdrawn/declined offers gave their slot back
      // when they left the live set. ──
      if ((task.offerCount ?? 0) >= DO_OFFER_MAX_PER_TASK) {
        throw new HttpsError(
          'resource-exhausted',
          `This task already has ${DO_OFFER_MAX_PER_TASK} open offers`,
          { reason: 'task_offer_cap' },
        );
      }

      // ── DO_OFFER_MAX_ACTIVE, against the caller's own live offers.
      // tx.get on the query keeps two concurrent submissions from both
      // passing the count. ──
      const liveOwn = await tx.get(
        db
          .collection('taskOffers')
          .where('doerUserId', '==', uid)
          .where('status', 'in', [...OFFER_LIVE_STATUSES]),
      );
      if (liveOwn.size >= DO_OFFER_MAX_ACTIVE) {
        throw new HttpsError(
          'resource-exhausted',
          `You can have at most ${DO_OFFER_MAX_ACTIVE} open offers`,
          { reason: 'offer_cap' },
        );
      }

      // ── The guardian gate (§6.2): flagged sub-category + supervised
      // caller → pending_guardian; else pending. Fail-closed on unknown
      // sub-category keys (requiresGuardianConsent's contract). ──
      const gated =
        requiresGuardianConsent(task.subCategory) && supervisingFamilyId !== null;
      status = gated ? 'pending_guardian' : 'pending';

      const offerDoc: Record<string, unknown> = {
        offerId: offerRef.id,
        taskId,
        doerUserId: uid,
        familyId: task.familyId,
        // §4.2 block 1: the family's offer card renders under the offer
        // read rule alone — name, photo, bio; nothing that locates.
        doerFirstName: (callerData.firstName as string) || '',
        doerPhotoUrl: resolveDoerPhotoUrl(callerData),
        doerBio: (doerProfile.bio as string | null | undefined) ?? null,
        // §4.2 block 2: the student's "My offers" list renders terminal
        // offers from the offer doc alone — board-visible facts only.
        taskTitle: task.title,
        taskCategory: task.category,
        taskTiming: task.timing,
        price: data.price as number,
        priceBasis: data.priceBasis as 'flat' | 'hourly',
        message: (data.message as string).trim(),
        helper,
        availabilityNote:
          typeof data.availabilityNote === 'string'
            ? data.availabilityNote.trim() || null
            : null,
        status,
        declinedReason: null,
        createdAt: now,
        updatedAt: now,
      };
      // ABSENT, never null, on non-gated offers (§4.2's rules-layer
      // contract). tx.set WITHOUT merge also strips any guardian map a
      // resurrected offer carried from a previous gated life.
      if (gated) {
        offerDoc.guardian = {
          required: true,
          familyId: supervisingFamilyId,
          decidedAt: null,
          decidedByUid: null,
        };
      }
      tx.set(offerRef, offerDoc);
      tx.update(taskRef, {
        offerCount: (task.offerCount ?? 0) + 1,
        updatedAt: now,
      });
      taskTitle = task.title;
      taskFamilyId = task.familyId;
    });

    // Notify AFTER the commit (plan §10 / §13 PR9; post-commit invariant —
    // failures log, never reject). A `pending` offer notifies the hiring
    // family; a `pending_guardian` offer notifies the SUPERVISING family
    // instead — the hiring family must not learn a gated offer exists
    // (§6.2's invisibility promise starts here, not at the decision).
    //
    // The supervising-family notice is NOT the guardian-mirror duplication
    // acceptOffer avoids (PR #334 review): it is an approval DECISION
    // addressed to the parent themselves, and nothing else emits it. It also
    // cannot double with `mirrorNotificationToGuardians` — that trigger keys
    // off the RECIPIENT's `governedBy`, and these recipients are parents, who
    // carry none. The offering student is deliberately sent nothing here, so
    // there is no student notification for the trigger to mirror either.
    // Fallback resolved inside the content closures below, where the
    // recipient's language is known — an English literal would render « A
    // student vous propose… » in French mail (PR #334 round-3 review).
    const doerFirstName = (callerData.firstName as string | undefined) || null;
    await notifyDoSafely('submitOffer', async () => {
      if (status === 'pending') {
        await notifyDoFamilyParents(taskFamilyId, {
          type: 'task_offer_received',
          prefCategory: 'newRequest',
          content: (lang) =>
            buildTaskOfferReceived(lang, {
              doerFirstName: doerFirstName ?? fallbackDoerName(lang),
              taskTitle,
              taskId,
              price: data.price as number,
              priceBasis: data.priceBasis as 'flat' | 'hourly',
            }),
          data: { taskId, offerId: offerRef.id },
        });
      } else if (supervisingFamilyId !== null) {
        // Gated on `newRequest` until issue #168 Phase-2 gives sync-do its own
        // pref categories (§10 tells this PR not to pre-empt that) — a
        // deliberate tradeoff worth stating, because this is the one do type
        // where a muted category loses an ACTION rather than information: a
        // parent who muted `newRequest` in Sync/Sit ("new babysitting
        // request") is not told their child is waiting on a consent decision,
        // and the offer just expires unseen by the hiring family (§6.2). The
        // in-app row is still written either way, and the digest's
        // `prefCategory: null` is the escape hatch if this is ever revisited.
        await notifyDoFamilyParents(supervisingFamilyId, {
          type: 'task_guardian_approval',
          prefCategory: 'newRequest',
          content: (lang) =>
            buildGuardianApprovalRequested(lang, {
              childFirstName: doerFirstName ?? fallbackDoerName(lang),
              taskTitle,
            }),
          data: { taskId, offerId: offerRef.id },
        });
      }
    });

    await writeUserActivity(uid, 'do.offer_submitted', {
      offerId: offerRef.id,
      taskId,
      status,
      resurrected,
    });

    return { offerId: offerRef.id, status };
  },
);
