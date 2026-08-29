import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { isLateCancellation } from '@ejm/shared-functions/schedule/lateCancellation.js';
import { parisWallTimeToUtc } from '@ejm/shared-functions/scheduled/parisTime.js';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { escapeHtml, sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';
import { notifyAllParents } from '../config/notifyParents.js';
import { getParentProfile, isBabysitter, resolveNotifPref, type User } from '@ejm/shared-core';
import {
  isActiveGuardianOf,
  notifyChildOfGuardianAction,
} from '@ejm/shared-functions/guardian/guardianAccess.js';
import {
  buildRestoredOverride,
  type SessionBlockEntry,
} from '@ejm/shared-functions/schedule/sessionOverride.js';
import { SIT_APP_URL } from '@ejm/shared-functions';

/** sit's provenance stamp + ownership gate (see buildRestoredOverride). */
const SIT_PROVENANCE = { appSource: 'sit', reason: 'appointment' } as const;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface CancelInput {
  appointmentId: string;
  reason: string;
}

export const cancelAppointment = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const { appointmentId, reason } = request.data as CancelInput;

    if (!appointmentId || !reason?.trim()) {
      throw new HttpsError('invalid-argument', 'Appointment ID and reason are required');
    }

    const aptRef = db.collection('appointments').doc(appointmentId);
    const aptSnap = await aptRef.get();

    if (!aptSnap.exists) {
      throw new HttpsError('not-found', 'Appointment not found');
    }

    const apt = aptSnap.data()!;

    if (apt.status !== 'confirmed' && apt.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Only confirmed or pending appointments can be cancelled');
    }

    // Determine if caller is the babysitter, a parent of the appointment's
    // family, or a GUARDIAN (a parent of the babysitter's ACTIVE supervising
    // family) acting on the babysitter's side — same statusReason, same
    // machinery.
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerParent = getParentProfile(callerDoc.data() as User | undefined);
    let cancelledBy: string;
    let guardianActor = false;

    if (isBabysitter(callerDoc.data() as User | undefined) && apt.babysitterUserId === uid) {
      cancelledBy = 'cancelled_by_babysitter';
    } else if (callerParent && callerParent.familyId === apt.familyId) {
      cancelledBy = 'cancelled_by_family';
    } else if (await isActiveGuardianOf(uid, apt.babysitterUserId as string)) {
      cancelledBy = 'cancelled_by_babysitter';
      guardianActor = true;
    } else {
      throw new HttpsError('permission-denied', 'You are not part of this appointment');
    }

    const now = new Date();

    // Update appointment
    // Allow-but-flag (issue #237, study's V2 feature 7 ported): a CONFIRMED
    // one_time cancel inside the snapshotted notice window is recorded as
    // late, whoever cancels -- the flag is a record, not a punishment.
    // Recurring appointments are never flagged: study's recurring lateness
    // lives per-instance and sit has no instance model, so a whole-series
    // cancel has no single start time to be late against.
    //
    // Deviation from study (PR #248 round 2): the flag applies only BEFORE
    // the start. Study never reaches a stale cancel -- its
    // markSessionsCompleted cron flips past confirmed sessions to completed,
    // making them uncancellable -- but sit has no completed sweep, so months
    // -old confirmed appointments stay cancellable as cleanup. Without this
    // gate, isLateCancellation (start < now + window) is trivially true for
    // every past appointment and cleanup would mint permanent user-visible
    // "Cancelled late" badges. The cost: a true no-show cancelled minutes
    // after start goes unflagged -- acceptable until sit grows a completed
    // state that can tell the two apart.
    const hasStart = typeof apt.date === 'string' && typeof apt.startTime === 'string';
    const started =
      hasStart &&
      parisWallTimeToUtc(apt.date as string, apt.startTime as string).getTime() < now.getTime();
    const late =
      apt.status === 'confirmed' &&
      apt.type === 'one_time' &&
      hasStart &&
      !started &&
      isLateCancellation(
        apt.date as string,
        apt.startTime as string,
        (apt.cancellationNoticeHours as number | undefined) ?? 0,
        now,
      );

    await aptRef.update({
      ...(late ? { lateCancellation: true } : {}),
      status: 'cancelled',
      statusReason: cancelledBy,
      cancelledFromStatus: apt.status,
      cancellationReason: reason.trim(),
      cancelledAt: now,
      updatedAt: now,
    });

    // ── Restore the schedule slots this appointment claimed (H3) ──
    // A confirmed appointment that blocked the babysitter's schedule recorded a
    // `sessionBlocks` ledger entry (respondToRequest). Remove ONLY that entry and
    // give back exactly the slots it held (buildRestoredOverride, shared with
    // study) so cross-app claims survive. LEGACY pre-H3 overrides carry no ledger
    // entry for this appointment → nothing matches → the doc is left untouched
    // (conservative, status quo). Transactional: read the override before writing.
    if (apt.status === 'confirmed' && apt.date) {
      const scheduleRef = db.collection('schedules').doc(apt.babysitterUserId);
      const overrideRef = scheduleRef.collection('overrides').doc(apt.date as string);
      const scheduleSnap = await scheduleRef.get();
      const dayKey = DAY_KEYS[new Date(`${apt.date}T00:00:00`).getDay()];
      const weeklySlots: boolean[] = scheduleSnap.data()?.weekly?.[dayKey] ?? [];
      const matches = (b: SessionBlockEntry) => b.appointmentId === appointmentId;

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(overrideRef);
        if (!snap.exists) return;
        const existing = snap.data()!;
        const ledger = Array.isArray(existing.sessionBlocks)
          ? (existing.sessionBlocks as SessionBlockEntry[])
          : [];
        // No entry to remove (legacy/ledgerless, or blockSchedule was never set)
        // → leave the doc exactly as it is.
        if (!ledger.some(matches)) return;

        const restore = buildRestoredOverride({
          existing,
          matches,
          weeklySlots,
          ownProvenance: SIT_PROVENANCE,
          now,
        });
        if (restore.action === 'delete') tx.delete(overrideRef);
        else if (restore.action === 'set') tx.set(overrideRef, restore.doc);
      });
    }

    // Send notifications to the OTHER party
    if (cancelledBy === 'cancelled_by_family') {
      // Notify babysitter
      const babysitterDoc = await db.collection('users').doc(apt.babysitterUserId).get();
      const babysitterEmail = babysitterDoc.data()?.email;
      const babysitterPrefs = resolveNotifPref(babysitterDoc.data()?.notifPrefs, 'sit', 'cancelled');
      const familyName = apt.familyName || 'A family';

      const dateInfo = apt.date ? `${apt.date}${apt.startTime ? `, ${apt.startTime}` : ''}${apt.endTime ? `–${apt.endTime}` : ''}` : 'Recurring';

      await db.collection('notifications').add({
        recipientUserId: apt.babysitterUserId,
        type: 'request_cancelled',
        title: 'Appointment cancelled',
        body: `${familyName} has cancelled the appointment for ${dateInfo}. Reason: ${reason.trim()}`,
        data: { appointmentId },
        read: false,
        channels: ['email'],
        emailSent: false,
        pushSent: false,
        createdAt: now,
      });

      if (babysitterPrefs.email && babysitterEmail) {
        await sendNotificationEmail(
          babysitterEmail,
          `Appointment cancelled by ${familyName}`,
          `<p><strong>${escapeHtml(familyName)}</strong> has cancelled the appointment for <strong>${escapeHtml(dateInfo)}</strong>.</p>
           <p><strong>Reason:</strong> ${escapeHtml(reason.trim())}</p>
           <p style="margin-top: 16px;"><a href="${SIT_APP_URL}/babysitter" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Dashboard</a></p>`
        );
      }

      if (babysitterPrefs.push) {
        await sendPushNotification(
          apt.babysitterUserId,
          'Appointment cancelled',
          `${familyName} has cancelled the appointment.`,
          { appointmentId, type: 'request_cancelled' }
        );
      }
    } else {
      // Notify all parents in family
      const dateInfo = apt.date ? `${apt.date}${apt.startTime ? `, ${apt.startTime}` : ''}${apt.endTime ? `–${apt.endTime}` : ''}` : 'Recurring';

      await notifyAllParents({
        familyId: apt.familyId,
        prefCategory: 'cancelled',
        type: 'request_cancelled',
        title: 'Appointment cancelled',
        body: `The babysitter has cancelled the appointment for ${dateInfo}. Reason: ${reason.trim()}`,
        emailSubject: 'Babysitting appointment cancelled',
        emailBody: `<p>The babysitter has cancelled the appointment for <strong>${escapeHtml(dateInfo)}</strong>.</p>
           <p><strong>Reason:</strong> ${escapeHtml(reason.trim())}</p>
           <p style="margin-top: 16px;"><a href="${SIT_APP_URL}/family/search" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Search Babysitters</a></p>`,
        data: { appointmentId },
      });
    }

    if (guardianActor) {
      await notifyChildOfGuardianAction(
        apt.babysitterUserId as string,
        `A parent of your family cancelled your appointment${
          apt.date ? ` for ${apt.date}` : ''
        }. Reason: ${reason.trim()}`,
        { appointmentId },
      );
    }

    await writeUserActivity(uid, cancelledBy, {
      appointmentId,
      reason: reason.trim(),
      ...(guardianActor ? { actorRole: 'guardian' } : {}),
    });

    return { success: true };
  }
);
