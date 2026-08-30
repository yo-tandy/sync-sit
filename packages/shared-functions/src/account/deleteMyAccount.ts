import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { eraseUserAccount } from '../admin/deleteUser.js';
import { raisePartialErasureAlert } from '../admin/partialErasureAlert.js';
import { writeAuditLog } from '../admin/writeAuditLog.js';
import {
  escapeHtml,
  sendAdminNotification,
  sendNotificationEmail,
} from '../config/email.js';
import { sendPushNotification } from '../config/push.js';
import { effectiveAuthTimeSeconds } from '../auth/effectiveAuthTime.js';

/**
 * Time within which the member must have presented a CREDENTIAL for a
 * self-delete to be accepted.
 *
 * This is irreversible and it is reachable from a signed-in session, so an
 * unattended or borrowed device should not be enough. A member who has been
 * signed in for longer is asked to re-authenticate and try again. Fifteen
 * minutes is long enough to read the confirmation copy and think about it,
 * short enough that a walked-away-from session has expired.
 *
 * The age comes from `effectiveAuthTimeSeconds`, NOT from `auth_time`
 * directly. `auth_time` alone was bypassable: cross-app handoff mints a custom
 * token for the session's uid, and signing in with it stamps a fresh
 * `auth_time` without anyone typing a password — so a borrowed unlocked phone
 * could switch apps and land back inside this window. The handoff now carries
 * the originating session's credential age across, and the helper takes the
 * older of the two. See `auth/effectiveAuthTime.ts` for the full rule.
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
 * @param authTimeSeconds the session's effective credential age in seconds
 *   since epoch — `effectiveAuthTimeSeconds(request.auth.token)`, not raw
 *   `auth_time` (see REAUTH_WINDOW_SECONDS). 0/NaN/absent means a token shape
 *   we did not expect, which is treated as stale rather than as permission.
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
 * Tell a supervising family that their supervised member deleted their own
 * account (owner decision, 2026-08-29: a minor MAY delete their own account,
 * and their supervising parent is told).
 *
 * DELIBERATELY IGNORES notifPrefs, unlike `notifyAllParents`. Those
 * preferences exist so a parent can turn down booking chatter; none of their
 * categories (newRequest / confirmed / cancelled / reminders / references)
 * describes this, and routing it through one would mean a parent who muted
 * "cancelled" emails silently never learns their child left the platform.
 * A guardian being informed about a minor in their care is a safeguarding
 * message, not a notification setting.
 *
 * Best-effort per channel and per parent: the account is already gone by the
 * time this runs, so a failing email must not surface as a failed deletion.
 *
 * Returns TWO counts, not one. An earlier version returned a single
 * `notified`, incremented once per parent whose user doc existed — which reads
 * as "the guardian was told" while recording success for a guardian nothing
 * reached (no email address, no push tokens, and an in-app doc nobody opens).
 * That is the precise failure this number exists to catch, so the trail now
 * distinguishes "there was nobody to tell" from "we tried and nothing landed":
 *   - `found`   — guardians the supervising family names.
 *   - `reached` — guardians at least one CHANNEL actually delivered to.
 * `found > reached` in an audit entry is the signal to look.
 *
 * Exported for that reason and no other: the emulator's mail transport
 * short-circuits to `true` for any address, and every production writer of a
 * `users` doc sets `email` — so a guardian both channels miss is a state the
 * integration suite CANNOT stage without seeding a document shape production
 * never writes. It is reachable in production (Resend rejects the send, no FCM
 * registration), so the two counts diverging is pinned where the channel
 * results are inputs rather than fixtures. See
 * `__tests__/guardianNotifyCounts.test.ts`.
 */
export async function notifyGuardiansOfSelfDelete(
  familyId: string,
  childUid: string,
  childName: string,
): Promise<{ found: number; reached: number }> {
  const familyDoc = await db.collection('families').doc(familyId).get();
  const parentIds: string[] = familyDoc.data()?.parentIds ?? [];
  const now = new Date();
  const name = childName.trim() || 'A supervised member';

  const title = 'A supervised account was deleted';
  const body = `${name} deleted their account. They are no longer on the platform and your supervision of them has ended.`;

  // Every parent the family names is one the guardian duty was owed to,
  // including one whose user doc has gone missing — that is a guardian who was
  // NOT told, and the count must say so rather than skip them silently.
  const found = parentIds.length;
  let reached = 0;
  for (const parentId of parentIds) {
    const parentData = (await db.collection('users').doc(parentId).get()).data();
    if (!parentData) continue;

    let emailSent = false;
    if (parentData.email) {
      emailSent = await sendNotificationEmail(
        parentData.email,
        title,
        `<p>${escapeHtml(name)} deleted their own account.</p>
         <p>They are no longer on the platform, and your supervision of them has ended. Their data has been removed.</p>
         <p>If you did not expect this, please contact us.</p>`,
        // Branding only -- `sendNotificationEmail` has no 'auto' and the
        // address is the same whichever app sends it. 'sit' is the suite's
        // default identity; a guardian who only uses sync/study still
        // receives the mail, it just carries sit branding.
        'sit',
      );
    }

    // 'auto', matching every other guardian notification in the repo
    // (`createKidInvite`, `revokeSupervision`, `forceRevokeSupervision`,
    // `guardianAccess`, `guardianSetChildSearchable`). An explicit app makes
    // `sendPushNotification` read that app's token array ALONE, so a guardian
    // who only installed the sync/study or sync/do PWA has no `sit` tokens and
    // the send returns false without trying -- leaving email as the only
    // channel to a safeguarding message. Affinity resolution finds their
    // actual install instead.
    const pushSent = await sendPushNotification(
      parentId,
      title,
      body,
      { type: 'supervised_account_deleted' },
      'auto',
    );

    await db.collection('notifications').add({
      recipientUserId: parentId,
      type: 'supervised_account_deleted',
      title,
      // `body` DOES name the child, deliberately (review round 6 asked for
      // this to be settled rather than left ambiguous, and it was ambiguous:
      // the note below reads as a rule about the whole document).
      //
      // The rule is about the STRUCTURED payload, not the human copy. A
      // guardian who supervises two minors cannot act on "a supervised
      // account was deleted", and this is the one channel that persists: if
      // both the email and the push missed — the case `reached` exists to
      // surface — the in-app doc is the only record the guardian ever gets.
      // The recipient is the child's own supervising parent, the read is
      // restricted to them (`firestore.rules:590`), and `cleanupOldData`
      // sweeps the doc at 30 days, so the name is bounded and goes nowhere
      // the parent does not already have it.
      body,
      // `data` is the other half of that rule and keeps the uid alone: it is
      // the payload other code consumes, and nothing downstream should be
      // able to re-derive a display name for an account that no longer
      // exists.
      data: { childUid },
      read: false,
      channels: ['email', 'push'],
      emailSent,
      pushSent,
      createdAt: now,
    });
    // Only a delivered channel counts. The in-app doc above is deliberately
    // NOT one: it is written unconditionally, so counting it would make
    // `reached` unconditional again and put the same lie back in the log.
    if (emailSent || pushSent) reached += 1;
  }
  return { found, reached };
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
 * A SUPERVISED MINOR MAY DELETE THEIR OWN ACCOUNT (owner decision,
 * 2026-08-29). The delete is not blocked or held for guardian approval --
 * they are the data subject, and refusing would be a GDPR erasure request
 * denied. Their supervising guardian is NOTIFIED instead, after the fact,
 * which keeps the governance interest (#102-#107) without giving a guardian
 * a veto over erasure.
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
    assertSelfDeleteAllowed(
      effectiveAuthTimeSeconds(request.auth.token as Record<string, unknown>),
      Date.now(),
      confirm,
    );

    // No pre-read of the user doc here. `eraseUserAccount`'s first act is to
    // read the same document and throw `not-found` before it writes anything,
    // and every identity value used below (firstName / lastName / email /
    // role) comes off its return value — so a read here would be dead weight
    // whose only effect was a different error string.
    const erased = await eraseUserAccount(uid, uid);
    // The supervising family comes back OUT of the erasure rather than being
    // read here first: `eraseUserAccount` deletes `guardianLinks/{uid}`, so a
    // read placed after it would silently return nothing and the guardian
    // would never be told. Taking it from the return value makes that
    // ordering impossible to get wrong.
    const supervisingFamilyId = erased.supervisingFamilyId;

    // Owner decision: a supervised minor MAY delete their own account, and
    // their guardian is told. Sent AFTER the erasure so the message is only
    // ever "this happened", never "this is about to". Best-effort: the
    // account is already gone, so a mail failure must not read as a failed
    // deletion.
    let guardians = { found: 0, reached: 0 };
    if (supervisingFamilyId) {
      try {
        guardians = await notifyGuardiansOfSelfDelete(
          supervisingFamilyId,
          uid,
          `${erased.firstName} ${erased.lastName}`,
        );
      } catch (err) {
        console.error('[deleteMyAccount] guardian notification failed', { uid, err });
      }
    }

    // Same helper the admin path uses, with `selfDeleted: true` so an operator
    // triaging `adminAlerts` can tell which path produced it — an admin delete
    // has a human who can be asked what happened, this one does not.
    const erasureFailures = await raisePartialErasureAlert(uid, erased, true);

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
        // Whether this account was supervised, how many guardians the family
        // named, and how many a channel actually delivered to. Recorded
        // because "the guardian was informed" is the part of this decision
        // that could fail silently — and a single count cannot say whether
        // there was nobody to tell or nothing landed. `guardiansFound >
        // guardiansReached` is the entry to investigate.
        wasSupervised: !!supervisingFamilyId,
        guardiansFound: guardians.found,
        guardiansReached: guardians.reached,
        // issue #408 item 1 -- counts only, no personal data (the
        // `deletedReferences` convention). Mirrors `deleteUser`.
        deletedScheduleOverrides: erased.scheduleOverridesDeleted,
        releasedAppointmentClaims: erased.sitClaimsReleased,
        anonymizedStudySessions: erased.studyErasure.sessionsAnonymized,
        cancelledStudySessions: erased.studyErasure.sessionsCancelled,
        cancelledStudyInstances: erased.studyErasure.instancesCancelled,
        scrubbedStudyInstances: erased.studyErasure.instancesScrubbed,
        releasedStudyClaims: erased.studyErasure.claimsReleased,
        // A non-zero value means the erasure was PARTIAL. It is recorded
        // here, shown in the admin email, and raised as an adminAlert -- the
        // user document is gone by now, so the erasure cannot simply be
        // re-run and a silent skip would leave un-anonymized personal data
        // with nobody aware of it. That reasoning is STRONGER on this path
        // than on the admin one, for the same reason the audit entry itself
        // is: there is no second person who witnessed it.
        erasureFailures,
      },
    });

    await sendAdminNotification(
      `Account self-deleted: ${erased.email}`,
      `<p>A member deleted their own account.</p>
       <p><strong>Name:</strong> ${escapeHtml(erased.firstName)} ${escapeHtml(erased.lastName)}</p>
       <p><strong>Email:</strong> ${escapeHtml(erased.email)}</p>
       <p><strong>Role:</strong> ${erased.role ?? 'none'}</p>
       <p><strong>Cancelled appointments:</strong> ${erased.cancelledCount}</p>
       <p><strong>Family deleted:</strong> ${erased.isLastParent && !!erased.familyId ? 'Yes' : 'No'}</p>
       ${
         erasureFailures > 0
           ? `<p><strong>⚠ PARTIAL ERASURE:</strong> ${erasureFailures} cascade(s) failed — personal data may remain. See adminAlerts.</p>`
           : ''
       }`,
    );

    return { success: true, cancelledAppointments: erased.cancelledCount };
  },
);
