import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  getDoerProfile,
  validateEndorsementRefName,
  validateEndorsementText,
} from '@ejm/do-core';
import type { User } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { callerFamilyId } from './taskAccess.js';
import { loadActiveCaller } from './offerAccess.js';
import {
  REFERENCES,
  findQualifyingCompletedTask,
  validDoerUserId,
} from './endorsementAccess.js';
import { notifyDoSafely, sendDoNotificationSafely } from './notify.js';
import { buildEndorsementReceived } from './notifyContent.js';

/**
 * `doSubmitEndorsement` (plan decision 12 as revised, §9.1, §13 PR11): a
 * family endorses a doer after a completed task. Mirrors study's
 * `submitTutorEndorsement` step for step, with three deliberate
 * differences, each recorded where it is made:
 *
 *  1. the RELATIONSHIP gate is a completed, assigned task rather than
 *     `approvedFamilies` membership (see `findQualifyingCompletedTask`);
 *  2. no `subject` — a server-derived `category`, copied from the
 *     qualifying task, takes its slot;
 *  3. the notification goes through the sync-do sender (`notify.ts`), so
 *     it is do-branded, per-recipient localized EN+FR, and — for a
 *     supervised student — CC'd to their guardians by the platform's
 *     `mirrorNotificationToGuardians` trigger rather than by a second write
 *     here (the PR #334 rule this PR inherits).
 *
 * The doc is written `private`: nothing renders on an offer card until the
 * doer accepts (`doRespondToEndorsement`). That is the consent model the
 * whole `references` collection runs on, and the reason the §12/#300 read
 * rule amendment is a prerequisite — without the `doerUserId` recipient
 * disjunct the doer cannot read the doc this callable just wrote about them.
 */
export const doSubmitEndorsement = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as Record<string, unknown>;
    const doerUserId = validDoerUserId(data.doerUserId);

    for (const err of [
      validateEndorsementText(data.referenceText),
      validateEndorsementRefName(data.refName),
    ]) {
      if (err !== null) throw new HttpsError('invalid-argument', err);
    }
    const referenceText = (data.referenceText as string).trim();
    const refName = (data.refName as string).trim();

    // ── Caller gate: an active parent in a family. NO family-verification
    //    gate: posting the task already required it (§11.1), and the
    //    completed-task relationship below is the stronger fact — the same
    //    reasoning submitTutorEndorsement records for leaving it out. ──
    const callerData = await loadActiveCaller(uid);
    const familyId = callerFamilyId(callerData);
    if (familyId === null) {
      throw new HttpsError(
        'permission-denied',
        'Only parents in a family can submit endorsements',
      );
    }

    // ── Not-self ──
    if (doerUserId === uid) {
      throw new HttpsError('invalid-argument', 'Cannot endorse yourself');
    }

    // ── Relationship gate FIRST: a completed task this family assigned to
    //    them. Order is the whole point (issue #357 item 1). With the
    //    enrollment check ahead of it, the two refusals were distinguishable
    //    for ANY uid a caller cared to name — `not-found` meant "this uid is
    //    not an enrolled doer", `permission-denied` meant "it is, but you
    //    have never worked with them" — which turns this callable into an
    //    enumeration oracle over doer accounts for anyone with one completed
    //    task. Running the relationship gate first means a caller only ever
    //    learns about students their own family has actually hired, which is
    //    how the platform's other lookups already behave. ──
    const task = await findQualifyingCompletedTask(familyId, doerUserId);
    if (task === null) {
      throw new HttpsError(
        'permission-denied',
        'Endorsements require a completed task with this student',
        { reason: 'no_completed_task' },
      );
    }

    // ── The doer must exist and be ENROLLED ──
    // Past the gate above this is no longer an oracle: the caller's own
    // family assigned this student a task and marked it complete, so the
    // account's existence is already known to them.
    //
    // `enrollmentComplete`, not merely "has a doer profile" (PR #352 round-2
    // review): a bare `getDoerProfile` read is satisfied by a half-finished
    // enrollment, and `enrollmentComplete` is what "enrolled" means
    // everywhere else in sync-do — §7.2's board read rule and §11.1's
    // offering gate both key on it, and `isActiveEnrolledDoer` is the house
    // predicate. An un-enrolled account cannot make offers, so it cannot be
    // the subject of a completed task honestly; if one is named here, the
    // request is malformed rather than merely unlucky.
    //
    // Deliberately NOT also gating on `status == 'active'`, which
    // `isActiveEnrolledDoer` adds: refusing a family's endorsement because
    // the student was banned AFTER the work was done is a different decision
    // from the one this callable is making, and nothing a banned account
    // could gain from it survives — `doRespondToEndorsement` runs the ban
    // gate, so a suspended doer cannot publish the endorsement at all, and a
    // `private` doc renders nowhere.
    const doerDoc = await db.collection('users').doc(doerUserId).get();
    const doerData = (doerDoc.data() ?? {}) as Record<string, unknown>;
    const doerProfile = getDoerProfile(doerData as unknown as User);
    if (!doerDoc.exists || doerProfile?.enrollmentComplete !== true) {
      throw new HttpsError('not-found', 'Doer not found');
    }

    // ── Dedup: one endorsement per (family, doer), study's rule. Equality
    //    filters only, so no composite index (see endorsementAccess).
    //
    //    STATUS-BLIND, matching study exactly (PR #352 round-2 review).
    //    `submitTutorEndorsement.ts:59-64` runs the same three equalities
    //    with no `status` filter, so in study a family that has been
    //    declined cannot re-endorse that tutor either. The consequence is
    //    worth stating rather than discovering: **declining is permanent for
    //    that (family, doer) pair** — the doc stays `removed`, and the
    //    family's next attempt is `already-exists`.
    //
    //    Kept because decision 12 says do's lifecycle mirrors study's, and a
    //    do-only divergence here would mean the two apps answer "can I
    //    endorse again?" differently for no reason a user could see.
    //    Excluding `removed` from the dedup is defensible — it is the
    //    recipient's own decline, not a platform judgement — but it is a
    //    PLATFORM behaviour change touching study, so it belongs in an issue
    //    against both apps rather than in one app's PR.
    //
    //    RACE-SAFE, in a transaction (issue #357 item 2). As a plain
    //    query-then-set() this was best-effort: two co-parents submitting at
    //    once both read an empty result and both wrote, and the surfaces
    //    would then show one family speaking twice on an offer card, with no
    //    way for either parent to remove the other's doc. `tx.get` on the
    //    query serializes the pair — the second submission re-runs and sees
    //    the first, exactly as submitOffer's per-doer ceiling does.
    //
    //    NOT a deterministic doc id, unlike the sync-do offer precedent
    //    (`${taskId}_${doerUserId}`). Two reasons, both about this collection
    //    rather than about ids:
    //      - `taskOffers` is `allow create: if false` — callables only — so a
    //        predictable id there is unreachable by clients. `references` is
    //        SHARED with sit and study and DOES allow client creates (a
    //        babysitter's own manual reference, any doc id). A predictable
    //        `${familyId}_${doerUserId}` would therefore be squattable: an
    //        attacker who creates a doc at that address permanently blocks a
    //        real family from ever endorsing that student, and the squatted
    //        doc is not removable by the victim (the update rule keys on the
    //        ATTACKER's `babysitterUserId`).
    //      - PR11 endorsements already in the database carry auto-ids, so an
    //        id-based invariant would not see them and this query would have
    //        had to stay anyway — leaving the "structural" fix structural for
    //        only half the data.
    //    Keeping the auto-id also keeps the doc's identity stable for
    //    everything that already reads one: the #311/#342 GDPR export and
    //    erasure paths (which key on FIELDS, not ids), the admin surfaces,
    //    and `doRespondToEndorsement`'s client-supplied `referenceId`. ──
    const familySnap = await db.collection('families').doc(familyId).get();
    const isEjmFamily = !!familySnap.data()?.verification?.isFullyVerified;
    const submittedByName = `${(callerData.firstName as string) || ''} ${
      (callerData.lastName as string) || ''
    }`.trim();

    // Concrete Date rather than a server timestamp: `createdAt` is read back
    // immediately by the §9.2 list, whose `orderBy('createdAt','desc')` would
    // otherwise sort a just-written doc by a null sentinel until the server
    // resolved it (the do call sites' existing convention — every task and
    // offer write in this codebase uses `new Date()` for the same reason).
    const now = new Date();
    const refDoc = db.collection(REFERENCES).doc();
    await db.runTransaction(async (tx) => {
      // Read before write (the transaction phase rule).
      const dup = await tx.get(
        db
          .collection(REFERENCES)
          .where('appSource', '==', 'do')
          .where('doerUserId', '==', doerUserId)
          .where('submittedByFamilyId', '==', familyId)
          .limit(1),
      );
      if (!dup.empty) {
        throw new HttpsError(
          'already-exists',
          'You have already endorsed this student',
          { reason: 'already_endorsed' },
        );
      }
      tx.set(refDoc, {
        referenceId: refDoc.id,
        doerUserId,
        appSource: 'do',
        type: 'family_submitted',
        status: 'private',
        submittedByUserId: uid,
        submittedByFamilyId: familyId,
        submittedByName,
        refName,
        referenceText,
        isEjmFamily,
        category: task.category,
        createdAt: now,
        updatedAt: now,
      });
    });

    // ── Notify the doer. Post-write and best-effort: the endorsement is
    //    stored, so a transport failure must not fail the callable and send
    //    the family back to a form that would now be refused
    //    `already-exists`. ──
    await notifyDoSafely('submitEndorsement', async () => {
      await sendDoNotificationSafely({
        recipientUserId: doerUserId,
        recipientData: doerData,
        type: 'doer_endorsement_received',
        // `newRequest`: something arrived that the recipient must act on —
        // the same class submitOffer's guardian-approval request uses, and
        // the closest of the three sit categories notify.ts exposes.
        prefCategory: 'newRequest',
        content: (lang) =>
          buildEndorsementReceived(lang, {
            submitterLabel: submittedByName || refName,
            taskTitle: task.title,
          }),
        data: { referenceId: refDoc.id },
      });
    });

    // Same post-write rule as the notify block above, for the same reason
    // (PR #352 round-1 review): the endorsement is already durable, and
    // `writeUserActivity` does a plain `auditLogs.add()` that can reject. An
    // unguarded throw here would return `internal` for an action that
    // SUCCEEDED — and the family's retry then hits the dedup query and is
    // refused `already-exists`, with no way forward. Matches
    // `doRespondToEndorsement`'s treatment of its own audit write.
    try {
      await writeUserActivity(uid, 'do.endorsement_submitted', {
        doerUserId,
        referenceId: refDoc.id,
        taskId: task.taskId,
      });
    } catch (err) {
      console.error('doSubmitEndorsement: audit write failed after commit:', err);
    }

    return { referenceId: refDoc.id };
  },
);
