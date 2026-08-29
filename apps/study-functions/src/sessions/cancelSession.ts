import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type {
  Transaction,
  DocumentReference,
} from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { escapeHtml, sendNotificationEmail, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import { parisDateString } from '@ejm/shared-functions/scheduled/parisTime.js';
import {
  isActiveGuardianOf,
  notifyChildOfGuardianAction,
} from '@ejm/shared-functions/guardian/guardianAccess.js';
import { getParentProfile, resolveNotifPref, type User } from '@ejm/shared-core';
import { dayOfWeek } from '@ejm/study-core';
import type { WeeklyGrid } from '../availability/computeDateAvailability.js';
import { cancelSessionSchema } from '../validation/session.js';
import { buildRestoredOverride, type RestoreResult } from './sessionOverride.js';
import { isLateCancellation } from './lateCancellation.js';

type CancelStatusReason = 'cancelled_by_tutor' | 'cancelled_by_family';

/** Apply a restoration result to an override ref inside the cancel transaction. */
function applyRestore(
  tx: Transaction,
  ref: DocumentReference,
  result: RestoreResult,
): void {
  if (result.action === 'delete') tx.delete(ref);
  else if (result.action === 'set') tx.set(ref, result.doc);
  // 'none' → the date had no override; nothing to do.
}

/**
 * cancelSession — cancel a pending or confirmed tutoring session.
 *
 * Either party may cancel at any time (v1 has no enforcement window): the
 * session's TUTOR, or a PARENT of the session's family. The role that cancelled
 * derives the statusReason ('cancelled_by_tutor' | 'cancelled_by_family') and
 * which side gets notified.
 *
 * The heart of this callable is LOSSLESS override-slot restoration (see
 * buildRestoredOverride): confirming a session AND-blocked the tutor's override
 * slots and recorded a restorable ledger entry, so cancelling must give back
 * exactly — and only — the slots that claim held.
 *
 *   • pending (one_time or recurring)  → pure status flip; a pending request
 *     never claimed any slots, so there is no override work.
 *   • confirmed one_time               → ONE transaction: restore the single
 *     date's override, flip the session.
 *   • confirmed recurring (series)     → ONE transaction: flip the parent, and
 *     for every FUTURE ('scheduled' AND date ≥ today Paris) instance flip it and
 *     restore its date's override. Past/completed/conflict_skip instances are
 *     untouched. Bounded (≤ ~8 future instances by construction).
 */
export const cancelSession = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = cancelSessionSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { sessionId, reason } = parsed.data;

    const now = new Date();
    const todayParis = parisDateString(now);
    const sessionRef = db.collection('study-sessions').doc(sessionId);

    // ── Load the session + caller, resolve role OUTSIDE the transaction ──
    const [sessionSnap, callerDoc] = await Promise.all([
      sessionRef.get(),
      db.collection('users').doc(uid).get(),
    ]);
    if (!sessionSnap.exists) {
      throw new HttpsError('not-found', 'Session not found');
    }
    const session = sessionSnap.data()!;

    if (session.status !== 'pending' && session.status !== 'confirmed') {
      throw new HttpsError(
        'failed-precondition',
        'Only a pending or confirmed session can be cancelled',
      );
    }

    // Caller = the session's tutor, else a parent of the session's family,
    // else a GUARDIAN (a parent of the tutor's ACTIVE supervising family)
    // acting on the provider's side — same statusReason, same machinery.
    let statusReason: CancelStatusReason;
    let guardianActor = false;
    if (session.tutorUserId === uid) {
      statusReason = 'cancelled_by_tutor';
    } else {
      const callerParent = getParentProfile(callerDoc.data() as User | undefined);
      if (callerParent?.familyId && callerParent.familyId === session.familyId) {
        statusReason = 'cancelled_by_family';
      } else if (await isActiveGuardianOf(uid, session.tutorUserId as string)) {
        statusReason = 'cancelled_by_tutor';
        guardianActor = true;
      } else {
        throw new HttpsError('permission-denied', 'You are not part of this session');
      }
    }

    const tutorUserId = session.tutorUserId as string;
    const scheduleRef = db.collection('schedules').doc(tutorUserId);

    // The tutor's weekly grid is static per-tutor config (NOT the contended claim
    // state the transaction re-reads), so it can be read once up front — mirrors
    // respondToSession's pre-transaction config load. Used as the restoration
    // base for any override we recompute.
    const scheduleSnap = await scheduleRef.get();
    const weekly: WeeklyGrid = (scheduleSnap.data()?.weekly as WeeklyGrid) ?? {};

    const cancelFields = {
      status: 'cancelled' as const,
      statusReason,
      cancellationReason: reason,
      cancelledFromStatus: session.status,
      cancelledAt: now,
      updatedAt: now,
    };

    // Snapshot taken at request creation (bookSession/proposeSession) — immutable
    // for this session, so a later profile edit cannot retro-classify it. For a
    // recurring series this lives on the parent and governs every instance.
    const noticeHours = (session.cancellationNoticeHours as number | undefined) ?? 0;

    // ── The cancel transaction (all reads before any writes) ──
    const outcome = await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(sessionRef);
      if (!freshSnap.exists) {
        throw new HttpsError('not-found', 'Session not found');
      }
      const fresh = freshSnap.data()!;
      // Re-check under the lock: guards the double-cancel race.
      if (fresh.status !== 'pending' && fresh.status !== 'confirmed') {
        throw new HttpsError(
          'failed-precondition',
          'Only a pending or confirmed session can be cancelled',
        );
      }
      const isRecurring = fresh.type === 'recurring';

      // Pending: a proposal that never claimed slots → pure status flip. A
      // pending request is never a late cancellation (nothing was committed).
      if (fresh.status === 'pending') {
        tx.update(sessionRef, cancelFields);
        return { type: fresh.type as string, late: false };
      }

      // Confirmed one_time: restore the single date's override, flip the session.
      if (!isRecurring) {
        const date = fresh.date as string;
        const overrideRef = scheduleRef.collection('overrides').doc(date);
        const overrideSnap = await tx.get(overrideRef);
        const existing = overrideSnap.exists ? overrideSnap.data()! : null;
        const restore = buildRestoredOverride({
          existing,
          sessionId,
          weeklySlots: weekly[dayOfWeek(date)] ?? [],
          now,
        });
        const late = isLateCancellation(
          fresh.date as string,
          fresh.startTime as string,
          noticeHours,
          now,
        );
        tx.update(sessionRef, late ? { ...cancelFields, lateCancellation: true } : cancelFields);
        applyRestore(tx, overrideRef, restore);
        return { type: 'one_time', late };
      }

      // Confirmed recurring: flip the parent, cancel every FUTURE scheduled
      // instance and restore its date's override. All reads first.
      const instancesSnap = await tx.get(sessionRef.collection('instances'));
      const affected = instancesSnap.docs.filter((d) => {
        const inst = d.data();
        return inst.status === 'scheduled' && (inst.date as string) >= todayParis;
      });
      const overrideRefs = affected.map((d) =>
        scheduleRef.collection('overrides').doc(d.data().date as string),
      );
      const overrideSnaps = await Promise.all(overrideRefs.map((r) => tx.get(r)));

      tx.update(sessionRef, cancelFields);
      let anyLate = false;
      for (let i = 0; i < affected.length; i++) {
        const instData = affected[i].data();
        const date = instData.date as string;
        const instLate = isLateCancellation(
          date,
          instData.startTime as string,
          noticeHours,
          now,
        );
        if (instLate) anyLate = true;
        tx.update(affected[i].ref, {
          status: 'cancelled',
          statusReason,
          cancellationReason: reason,
          cancelledAt: now,
          updatedAt: now,
          ...(instLate ? { lateCancellation: true } : {}),
        });
        const existing = overrideSnaps[i].exists ? overrideSnaps[i].data()! : null;
        const restore = buildRestoredOverride({
          existing,
          sessionId,
          instanceId: date,
          weeklySlots: weekly[dayOfWeek(date)] ?? [],
          now,
        });
        applyRestore(tx, overrideRefs[i], restore);
      }
      return { type: 'recurring', late: anyLate };
    });

    // ── ONE notification to the OTHER side ──
    const isSeries = outcome.type === 'recurring';
    const whenInfo = isSeries
      ? 'your recurring sessions'
      : `${session.date}${session.startTime ? `, ${session.startTime}` : ''}${
          session.endTime ? `–${session.endTime}` : ''
        }`;
    const seriesNote = isSeries
      ? '<p>This cancels the entire recurring series (all upcoming sessions).</p>'
      : '';
    // Accountability note when the cancel fell inside the notice window (soft
    // enforcement — the cancel still succeeded).
    const latePolicyNote = outcome.late
      ? `<p>This was a <strong>late cancellation</strong> under the ${escapeHtml(String(noticeHours))}-hour notice policy.</p>`
      : '';
    const lateSuffix = outcome.late ? ' (late cancellation)' : '';

    if (statusReason === 'cancelled_by_family') {
      // Notify the TUTOR directly (email + push + in-app), à la cancelAppointment.
      const tutorDoc = await db.collection('users').doc(tutorUserId).get();
      const tutorData = tutorDoc.data();
      const tutorEmail = tutorData?.email as string | undefined;
      const cancelPrefs = resolveNotifPref(tutorData?.notifPrefs, 'study', 'cancelled');
      const familyName = (session.familyName as string) || 'A family';
      const title = isSeries ? 'Recurring sessions cancelled' : 'Session cancelled';
      const body = `${familyName} cancelled ${isSeries ? 'the recurring series' : `the session for ${whenInfo}`}. Reason: ${reason}${lateSuffix}`;

      // Record the actual send outcomes, not assumptions.
      let emailSent = false;
      if (cancelPrefs.email && tutorEmail) {
        emailSent = await sendNotificationEmail(
          tutorEmail,
          `Session cancelled by ${familyName}`,
          `<p><strong>${escapeHtml(familyName)}</strong> cancelled ${
            isSeries ? 'your recurring tutoring series' : `the session for <strong>${escapeHtml(whenInfo)}</strong>`
          }.</p>
           ${seriesNote}
           <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
           ${latePolicyNote}
           <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/tutor" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>`,
          'study',
        );
      }
      // Send push before the doc write so pushSent records the real outcome.
      let pushSent = false;
      if (cancelPrefs.push) {
        pushSent = await sendPushNotification(tutorUserId, title, body, {
          sessionId,
          type: 'study_session_cancelled',
        }, 'study');
      }

      await db.collection('notifications').add({
        recipientUserId: tutorUserId,
        type: 'study_session_cancelled',
        title,
        body,
        data: { sessionId },
        read: false,
        channels: ['email', 'push'],
        emailSent,
        pushSent,
        createdAt: now,
      });
    } else {
      // Tutor cancelled → notify every parent in the family (cancelled prefs).
      const tutorName = (session.tutorName as string) || 'Your tutor';
      await notifyAllParents({
        familyId: session.familyId as string,
        prefCategory: 'cancelled',
        app: 'study',
        type: 'study_session_cancelled',
        title: isSeries ? 'Recurring sessions cancelled' : 'Session cancelled',
        body: `${tutorName} cancelled ${
          isSeries ? 'your recurring tutoring series' : `the session for ${whenInfo}`
        }. Reason: ${reason}${lateSuffix}`,
        emailSubject: `Session cancelled — ${tutorName}`,
        emailBody: `<p><strong>${escapeHtml(tutorName)}</strong> cancelled ${
          isSeries ? 'your recurring tutoring series' : `the session for <strong>${escapeHtml(whenInfo)}</strong>`
        }.</p>
           ${seriesNote}
           <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
           ${latePolicyNote}
           <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>`,
        data: { sessionId },
      });
    }

    if (guardianActor) {
      await notifyChildOfGuardianAction(
        tutorUserId,
        `A parent of your family cancelled ${
          isSeries ? 'your recurring series' : `your session on ${whenInfo}`
        }. Reason: ${reason}`,
        { sessionId },
      );
    }

    await writeUserActivity(uid, 'session_cancelled', {
      sessionId,
      reason,
      cancelledFromStatus: session.status,
      type: outcome.type,
      late: outcome.late === true,
      ...(guardianActor ? { actorRole: 'guardian' } : {}),
    });

    return { success: true };
  },
);
