import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import { escapeHtml, sendAdminNotification } from '../config/email.js';
import { raisePartialErasureAlert } from './partialErasureAlert.js';
import { performErasure } from './performErasure.js';

interface DeleteUserInput {
  targetUserId: string;
}

/**
 * Reads the target user doc and, if it is the LAST active admin, refuses to
 * erase it (issue #421, option 2b). Not a denial of the erasure right --
 * a PRECONDITION: appoint another admin and the same call succeeds. GDPR
 * still gets its erasure; the platform just never ends up with zero admins
 * able to grant it.
 *
 * Runs inside a Firestore transaction with a count taken AT CALL TIME, never
 * a value the caller read earlier -- and, when the check passes, the SAME
 * transaction immediately writes `erasureStartedAt: <now>` on the target.
 * NON-DESTRUCTIVE deliberately (review round on #421's first version, which
 * flipped `isAdmin: false` here): that write was the first thing this
 * function did, so an erasure that threw on ANY later step -- appointments,
 * schedule, references, sync-do, sync-study, any of it -- left the target
 * silently demoted and NOT deleted, with neither caller catching to notice.
 * A timestamp marker undoes cleanly (`eraseUserAccount`'s own catch below
 * clears it with `FieldValue.delete()` before rethrowing) where flipping a
 * real permission flag does not -- there is no "the erasure sort of failed"
 * value to restore it to.
 *
 * The marker still makes the count race-proof, which is the property this
 * function exists for: the active-admin QUERY (`isAdmin == true, status ==
 * active`) can return a doc that is already mid-erasure, so the eligible
 * count EXCLUDES any result carrying `erasureStartedAt`. Picture two admins,
 * exactly two active, each erasing the OTHER at the same moment: both
 * transactions run the identical query and both read every admin doc it
 * returns, including each other's target. Whichever commits first writes its
 * target's marker; Firestore then forces the second transaction to retry,
 * because it read the very doc the first one just changed. On retry the
 * query still returns that doc (its `isAdmin`/`status` are untouched), but
 * the EXCLUDE filter now drops it from the eligible count, so the second
 * call correctly sees one and refuses. A read-only check (no write) would let
 * both transactions see the same stale count of two and both pass, leaving
 * nobody able to administer the platform.
 *
 * Returns the target's data (read before the marker write) plus whether the
 * marker was actually written, so the caller knows whether it owns cleanup
 * duty on a later failure.
 */
async function guardAgainstLastAdmin(userRef: FirebaseFirestore.DocumentReference): Promise<{
  data: FirebaseFirestore.DocumentData;
  markerWritten: boolean;
}> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'User not found');
    }
    const data = snap.data()!;

    if (data.isAdmin === true && data.status === 'active') {
      const activeAdmins = await tx.get(
        db.collection('users').where('isAdmin', '==', true).where('status', '==', 'active'),
      );
      // A doc already mid-erasure (by a concurrent, still-in-flight call) is
      // not a REAL alternative admin — it is on its way out too.
      const eligible = activeAdmins.docs.filter((d) => d.data().erasureStartedAt == null);
      if (eligible.length <= 1) {
        throw new HttpsError(
          'failed-precondition',
          'You are the last active admin — appoint another admin first.',
          { code: 'admin/last-admin' },
        );
      }
      tx.update(userRef, { erasureStartedAt: new Date() });
      return { data, markerWritten: true };
    }

    return { data, markerWritten: false };
  });
}

/**
 * What deleting a member actually removes — the erasure itself, with no view
 * on WHO asked for it.
 *
 * A GDPR-compliant hard delete: it removes the user's personal data from
 * Firestore, anonymizes appointment references, anonymizes their study
 * sessions and releases the schedule claims a cancel leaves behind, deletes
 * their schedule and overrides, deletes their references and endorsements
 * (both as provider and as submitter), erases their sync-do tasks/offers and
 * both the `do-photos` and `do-uploads` object prefixes (scrubbing the
 * dangling `{uid, photoId}` entries off a co-parent's surviving tasks and
 * cancelling any surviving task assigned to them), and deletes the Firebase
 * Auth account.
 *
 * Extracted so the admin callable and the member's own
 * `deleteMyAccount` (issue #368) run the SAME code. The alternative was a
 * second delete path, and then two answers to "what does deleting a member
 * remove" — which is how orphaned data gets left behind. The caller is
 * responsible for authorising the delete and for the audit trail; this
 * function assumes that has already happened.
 *
 * `actorUid` is recorded on the guardian links this revokes -- for an admin
 * delete that is the admin, for a self-delete it is the member themselves,
 * which is the honest value in both cases.
 *
 * Throws `not-found` if the user document is gone.
 *
 * Throws `failed-precondition` (`admin/last-admin`) if the target is the
 * LAST active admin (issue #421, option 2b) -- see `guardAgainstLastAdmin`.
 * Checked here, inside the ONE function both `deleteUser` and
 * `deleteMyAccount` call, for the same reason the erasure itself lives here:
 * a guard wired into only one of the two callables is how the last admin
 * still gets erased through the other one.
 *
 * If the guard wrote its `erasureStartedAt` marker and the erasure THEN
 * throws on any later step, this function clears the marker (the target was
 * never actually deleted -- an admin left silently demoted with no data
 * removed is worse than the original race) and raises a
 * `partial_user_erasure` alert before rethrowing, so a half-erased admin is
 * loud rather than silent. Neither `deleteUser` nor `deleteMyAccount` gets a
 * chance to run their own `raisePartialErasureAlert` in this case -- their
 * shared call to `eraseUserAccount` never returns -- so this is the one place
 * that can raise it.
 */
export async function eraseUserAccount(targetUserId: string, actorUid: string) {
  const userRef = db.collection('users').doc(targetUserId);
  const { data: userData, markerWritten } = await guardAgainstLastAdmin(userRef);
  try {
    return await performErasure(userRef, userData, targetUserId, actorUid);
  } catch (err) {
    if (markerWritten) {
      // Best-effort, both independently: an erasure that already threw must
      // not throw a SECOND, different error out of this catch and bury the
      // original one.
      try {
        await userRef.update({ erasureStartedAt: FieldValue.delete() });
      } catch (clearErr) {
        console.error('[erasure] failed to clear the last-admin marker after a failed erasure', {
          targetUserId,
          err: clearErr,
        });
      }
      try {
        await db.collection('adminAlerts').add({
          type: 'partial_user_erasure',
          createdAt: new Date(),
          data: {
            targetUserId,
            // Distinguishes this from the ordinary partial-erasure alert
            // (`raisePartialErasureAlert`), which fires on a SUCCESSFUL
            // return with some per-item cascade failures -- this one fires
            // because the erasure never returned at all.
            reason: 'admin_erasure_threw_after_guard',
            selfDeleted: actorUid === targetUserId,
          },
        });
      } catch (alertErr) {
        console.error('[erasure] failed to raise the admin erasure-failure alert', {
          targetUserId,
          err: alertErr,
        });
      }
    }
    throw err;
  }
}

/**
 * An ADMIN deletes another member's account.
 *
 * Everything this callable owns is authorisation and the trail: it checks for
 * an admin, names the target, and — after `eraseUserAccount` has run — writes
 * the audit entry, raises the partial-erasure alert and mails the admins. The
 * erasure itself is shared with `deleteMyAccount` (#368), which is the point
 * of the extraction: one answer to "what does deleting a member remove".
 */
export const deleteUser = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { targetUserId } = request.data as DeleteUserInput;

    if (!targetUserId) {
      throw new HttpsError('invalid-argument', 'targetUserId is required');
    }

    const erased = await eraseUserAccount(targetUserId, request.auth.uid);
    const {
      role,
      email,
      familyId,
      cancelledCount,
      isLastParent,
      refDocsDeleted,
      doErasure,
      scheduleOverridesDeleted,
      sitClaimsReleased,
      studyErasure,
      now,
    } = erased;

    // 7. Alert first, then log. The alert is what an operator acts on, and it
    // returns the same total the audit entry records — so the number in the
    // trail and the condition that raised the alarm cannot disagree.
    const erasureFailures = await raisePartialErasureAlert(targetUserId, erased, false);

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'delete_user',
      targetUserId,
      details: {
        // A user may hold no profile at all (e.g. a governed kid deleted
        // before enrolling) — undefined is not a Firestore value.
        role: role ?? null,
        email,
        cancelledAppointments: cancelledCount,
        familyDeleted: isLastParent && !!familyId,
        deletedReferences: refDocsDeleted,
        // issue #408 item 2 — counts only, no personal data (same convention
        // as `deletedReferences`).
        deletedSearches: erased.searchesDeleted,
        deletedDoTasks: doErasure.tasksDeleted,
        deletedDoOffers: doErasure.offersDeleted,
        deletedDoPhotoObjects: doErasure.photoObjectsDeleted,
        scrubbedDoTaskPhotos: doErasure.tasksScrubbed,
        clearedDoAssignments: doErasure.assignmentsCleared,
        releasedDoOfferSlots: doErasure.offerSlotsReleased,
        // issue #408 item 1 — counts only, no personal data (the
        // `deletedReferences` convention).
        deletedScheduleOverrides: scheduleOverridesDeleted,
        releasedAppointmentClaims: sitClaimsReleased,
        anonymizedStudySessions: studyErasure.sessionsAnonymized,
        cancelledStudySessions: studyErasure.sessionsCancelled,
        cancelledStudyInstances: studyErasure.instancesCancelled,
        scrubbedStudyInstances: studyErasure.instancesScrubbed,
        releasedStudyClaims: studyErasure.claimsReleased,
        // Issue #420 — whether the counterparties of the cancelled
        // engagements were told, in the guardiansFound/guardiansReached
        // convention: `found > reached` is the entry to investigate, and
        // `counterpartyNotifyFailed` marks a fan-out that failed before it
        // could even count (distinct from "there was nobody to tell").
        counterpartiesFound: erased.counterparties.found,
        counterpartiesReached: erased.counterparties.reached,
        counterpartyNotifyFailed: erased.counterpartyNotifyFailed,
        // A non-zero value means the erasure was PARTIAL. It is recorded here,
        // shown in the admin email, and raised as an adminAlert — the user
        // document is gone by now, so `deleteUser` cannot simply be re-run and
        // a silent skip would leave un-anonymized personal data with nobody
        // aware of it.
        erasureFailures,
      },
    });

    await sendAdminNotification(
      `User deleted: ${email}`,
      `<p>Admin deleted a user account.</p>
       <p><strong>Name:</strong> ${escapeHtml(erased.firstName)} ${escapeHtml(erased.lastName)}</p>
       <p><strong>Email:</strong> ${escapeHtml(email)}</p>
       <p><strong>Role:</strong> ${role}</p>
       <p><strong>Cancelled appointments:</strong> ${cancelledCount}</p>
       <p><strong>Cancelled study sessions:</strong> ${studyErasure.sessionsCancelled}</p>
       <p><strong>Family deleted:</strong> ${isLastParent && !!familyId ? 'Yes' : 'No'}</p>
       ${
         erasureFailures > 0
           ? `<p><strong>⚠ PARTIAL ERASURE:</strong> ${erasureFailures} cascade(s) failed — personal data may remain. See adminAlerts.</p>`
           : ''
       }`
    );

    return { success: true, cancelledAppointments: cancelledCount };
  }
);
