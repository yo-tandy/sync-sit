import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { eraseUserAccount } from '../admin/deleteUser.js';
import { writeAuditLog } from '../admin/writeAuditLog.js';
import { escapeHtml, sendAdminNotification } from '../config/email.js';

/**
 * Time within which the member must have authenticated for a self-delete to
 * be accepted.
 *
 * This is irreversible and it is reachable from a signed-in session, so an
 * unattended or borrowed device should not be enough. Firebase puts the
 * original sign-in time in `auth_time`; a member who has been signed in for
 * longer is asked to re-authenticate and try again. Fifteen minutes is long
 * enough to read the confirmation copy and think about it, short enough that
 * a walked-away-from session has expired.
 */
const REAUTH_WINDOW_SECONDS = 15 * 60;

/** The word the member types to confirm. Not localised deliberately -- see below. */
const CONFIRMATION_TOKEN = 'DELETE';

interface DeleteMyAccountInput {
  confirm?: string;
}

/**
 * The two guards, as pure logic so they can be pinned without an emulator.
 *
 * Extracted deliberately: these are the whole difference between "a member
 * deletes their account" and "anything holding a stale session can delete a
 * member's account", and the Firestore wiring around them is only reachable
 * from the integration suite. Throws the same HttpsErrors the callable would.
 *
 * @param authTimeSeconds `auth_time` from the ID token — seconds since epoch,
 *   set at sign-in and refreshed by re-authentication. 0/NaN/absent means a
 *   token shape we did not expect, which is treated as stale rather than as
 *   permission.
 * @param nowMs current time in milliseconds.
 */
export function assertSelfDeleteAllowed(
  authTimeSeconds: number,
  nowMs: number,
  confirm: string | undefined,
): void {
  const authTime = Number(authTimeSeconds);
  if (!Number.isFinite(authTime) || authTime <= 0) {
    throw new HttpsError(
      'failed-precondition',
      'Please sign in again before deleting your account.',
    );
  }
  const ageSeconds = Math.floor(nowMs / 1000) - authTime;
  // A future auth_time (clock skew, tampering) is not "very recent" — it is
  // unexplained, so it fails closed like a stale one.
  if (ageSeconds < 0 || ageSeconds > REAUTH_WINDOW_SECONDS) {
    throw new HttpsError(
      'failed-precondition',
      'Please sign in again before deleting your account.',
    );
  }
  if (confirm !== CONFIRMATION_TOKEN) {
    throw new HttpsError('invalid-argument', 'Confirmation is required to delete an account.');
  }
}

/**
 * A member deletes their OWN account, across all three apps (issue #368).
 *
 * Until this existed there was no way for a member to delete themselves at
 * all: `deleteUser` requires an admin. The shared account hub's "Delete my
 * account" row promises the deletion removes them from sync/sit, sync/study
 * and sync/do, and this keeps that promise by running `eraseUserAccount` --
 * the SAME erasure the admin path runs, not a second implementation. That
 * matters more here than the code reuse suggests: two delete paths means two
 * answers to "what does deleting a member remove", and the one that drifts is
 * the one that leaves data behind.
 *
 * THE TARGET IS NEVER A PARAMETER. It is `request.auth.uid` and nothing else,
 * so no payload can steer this at another member. The admin callable is the
 * only way to delete someone else, and it checks for an admin.
 *
 * Two guards, because this cannot be undone:
 *  - recent authentication (see REAUTH_WINDOW_SECONDS)
 *  - an explicit confirmation token in the payload, so a stray call with no
 *    body cannot delete an account
 *
 * NOT GUARDED HERE, and deliberately left for the owner (see the PR): whether
 * a supervised minor may delete their own account without their guardian.
 * The governance work (#102-#107) established that guardians hold real
 * authority over a minor's participation, and self-deletion arguably sits
 * inside that authority -- but refusing the delete outright would also be a
 * GDPR erasure request being denied, which is its own problem. That needs a
 * decision, not a default, so this ships without a minor-specific branch and
 * the question is raised where it can be answered.
 */
export const deleteMyAccount = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;

    // The client asks the member to type the confirmation token. Comparing a
    // fixed token rather than a localised string keeps the check independent
    // of the UI language -- a French member types the same word, and the
    // server does not have to know which locale sent the request.
    const { confirm } = (request.data ?? {}) as DeleteMyAccountInput;
    assertSelfDeleteAllowed(Number(request.auth.token.auth_time ?? 0), Date.now(), confirm);

    // Read identity BEFORE the erasure: afterwards the document is gone and
    // there is nothing left to name in the audit log or the notification.
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Account not found.');
    }

    const erased = await eraseUserAccount(uid, uid);

    // The audit trail matters MORE for a self-delete than for an admin one,
    // not less: there is no second person who witnessed it. `adminUserId` is
    // the actor field, and here the actor is the member.
    await writeAuditLog({
      adminUserId: uid,
      action: 'self_delete_account',
      targetUserId: uid,
      details: {
        role: erased.role ?? null,
        email: erased.email,
        cancelledAppointments: erased.cancelledCount,
        familyDeleted: erased.isLastParent && !!erased.familyId,
        deletedReferences: erased.refDocsDeleted,
        deletedDoTasks: erased.doErasure.tasksDeleted,
        deletedDoOffers: erased.doErasure.offersDeleted,
        deletedDoPhotoObjects: erased.doErasure.photoObjectsDeleted,
        scrubbedDoTaskPhotos: erased.doErasure.tasksScrubbed,
        clearedDoAssignments: erased.doErasure.assignmentsCleared,
        releasedDoOfferSlots: erased.doErasure.offerSlotsReleased,
      },
    });

    await sendAdminNotification(
      `Account self-deleted: ${erased.email}`,
      `<p>A member deleted their own account.</p>
       <p><strong>Name:</strong> ${escapeHtml(erased.firstName)} ${escapeHtml(erased.lastName)}</p>
       <p><strong>Email:</strong> ${escapeHtml(erased.email)}</p>
       <p><strong>Role:</strong> ${erased.role ?? 'none'}</p>
       <p><strong>Cancelled appointments:</strong> ${erased.cancelledCount}</p>
       <p><strong>Family deleted:</strong> ${erased.isLastParent && !!erased.familyId ? 'Yes' : 'No'}</p>`,
    );

    return { success: true, cancelledAppointments: erased.cancelledCount };
  },
);
