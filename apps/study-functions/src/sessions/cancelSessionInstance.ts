import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { Transaction, DocumentReference } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { sendNotificationEmail } from '@ejm/shared-functions/config/email.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import { getParentProfile, type User } from '@ejm/shared-core';
import { dayOfWeek } from '@ejm/study-core';
import type { WeeklyGrid } from '../availability/computeDateAvailability.js';
import { cancelSessionInstanceSchema } from '../validation/session.js';
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
 * cancelSessionInstance — cancel ONE occurrence of a confirmed recurring series
 * without touching the parent or its other dates.
 *
 * Either party may cancel a single date: the instance's TUTOR, or a PARENT of
 * the instance's family (the check runs against the instance's OWN denormalized
 * tutorUserId / familyId — an instance is availability-authoritative on its
 * date, so a caller reads no parent to prove standing). Only a 'scheduled'
 * instance under a 'confirmed' parent can be cancelled.
 *
 * The transaction flips the instance to 'cancelled' and RESTORES that date's
 * override via buildRestoredOverride (the SAME lossless ledger inverse the whole
 * series-cancel uses; the entry is matched by sessionId + instanceId). The
 * cancelled instance doc PERSISTS as a settled decision: extendRecurring only
 * create-if-absent regenerates dates with NO instance, so it will never
 * resurrect this date.
 */
export const cancelSessionInstance = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = cancelSessionInstanceSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { sessionId, instanceId, reason } = parsed.data;

    const now = new Date();
    const sessionRef = db.collection('study-sessions').doc(sessionId);
    const instanceRef = sessionRef.collection('instances').doc(instanceId);

    // ── Load parent + instance + caller; validate + resolve role up front ──
    const [sessionSnap, instanceSnap, callerDoc] = await Promise.all([
      sessionRef.get(),
      instanceRef.get(),
      db.collection('users').doc(uid).get(),
    ]);
    if (!sessionSnap.exists) {
      throw new HttpsError('not-found', 'Session not found');
    }
    if (!instanceSnap.exists) {
      throw new HttpsError('not-found', 'Session occurrence not found');
    }
    const session = sessionSnap.data()!;
    const instance = instanceSnap.data()!;

    if (session.status !== 'confirmed') {
      throw new HttpsError(
        'failed-precondition',
        'Only an occurrence of a confirmed series can be cancelled',
      );
    }
    if (instance.status !== 'scheduled') {
      throw new HttpsError(
        'failed-precondition',
        'Only a scheduled occurrence can be cancelled',
      );
    }

    // Party check against the INSTANCE's own denormalized fields.
    const tutorUserId = instance.tutorUserId as string;
    const familyId = instance.familyId as string;
    let statusReason: CancelStatusReason;
    if (tutorUserId === uid) {
      statusReason = 'cancelled_by_tutor';
    } else {
      const callerParent = getParentProfile(callerDoc.data() as User | undefined);
      if (callerParent?.familyId && callerParent.familyId === familyId) {
        statusReason = 'cancelled_by_family';
      } else {
        throw new HttpsError('permission-denied', 'You are not part of this session');
      }
    }

    const scheduleRef = db.collection('schedules').doc(tutorUserId);
    // Weekly grid is static per-tutor config (see cancelSession) — read once, up
    // front, as the restoration base for a recomputed override.
    const scheduleSnap = await scheduleRef.get();
    const weekly: WeeklyGrid = (scheduleSnap.data()?.weekly as WeeklyGrid) ?? {};

    const date = instance.date as string; // === instanceId
    // Notice policy lives on the PARENT snapshot (taken at request creation); the
    // instance is late iff cancelled inside that window before its own start.
    const noticeHours = (session.cancellationNoticeHours as number | undefined) ?? 0;

    // ── The cancel transaction (all reads before any writes) ──
    const late = await db.runTransaction(async (tx) => {
      // Re-read the parent + instance authoritatively (guards double-cancel and a
      // parent cancelled out from under us between load and lock).
      const [freshParentSnap, freshInstSnap] = await Promise.all([
        tx.get(sessionRef),
        tx.get(instanceRef),
      ]);
      if (!freshParentSnap.exists || freshParentSnap.data()!.status !== 'confirmed') {
        throw new HttpsError(
          'failed-precondition',
          'Only an occurrence of a confirmed series can be cancelled',
        );
      }
      if (!freshInstSnap.exists || freshInstSnap.data()!.status !== 'scheduled') {
        throw new HttpsError(
          'failed-precondition',
          'Only a scheduled occurrence can be cancelled',
        );
      }

      const overrideRef = scheduleRef.collection('overrides').doc(date);
      const overrideSnap = await tx.get(overrideRef);
      const existing = overrideSnap.exists ? overrideSnap.data()! : null;
      const restore = buildRestoredOverride({
        existing,
        sessionId,
        instanceId,
        weeklySlots: weekly[dayOfWeek(date)] ?? [],
        now,
      });

      const instLate = isLateCancellation(
        freshInstSnap.data()!.date as string,
        freshInstSnap.data()!.startTime as string,
        noticeHours,
        now,
      );
      tx.update(instanceRef, {
        status: 'cancelled',
        statusReason,
        cancellationReason: reason,
        cancelledAt: now,
        updatedAt: now,
        ...(instLate ? { lateCancellation: true } : {}),
      });
      applyRestore(tx, overrideRef, restore);
      return instLate;
    });

    // ── ONE single-date notification to the OTHER side ──
    const startTime = instance.startTime as string | undefined;
    const endTime = instance.endTime as string | undefined;
    const whenInfo = `${date}${startTime ? `, ${startTime}` : ''}${endTime ? `–${endTime}` : ''}`;
    const latePolicyNote = late
      ? `<p>This was a <strong>late cancellation</strong> under the ${noticeHours}-hour notice policy.</p>`
      : '';
    const lateSuffix = late ? ' (late cancellation)' : '';

    if (statusReason === 'cancelled_by_family') {
      // Notify the TUTOR directly (email + push + in-app).
      const tutorDoc = await db.collection('users').doc(tutorUserId).get();
      const tutorData = tutorDoc.data();
      const tutorEmail = tutorData?.email as string | undefined;
      const cancelPrefs = tutorData?.notifPrefs?.cancelled;
      const familyName = (session.familyName as string) || 'A family';
      const title = 'Session cancelled';
      const body = `${familyName} cancelled the session on ${whenInfo}. Reason: ${reason}${lateSuffix}`;

      await db.collection('notifications').add({
        recipientUserId: tutorUserId,
        type: 'study_session_cancelled',
        title,
        body,
        data: { sessionId, instanceId },
        read: false,
        channels: ['email', 'push'],
        emailSent: cancelPrefs?.email !== false,
        pushSent: false,
        createdAt: now,
      });

      if (cancelPrefs?.email !== false && tutorEmail) {
        await sendNotificationEmail(
          tutorEmail,
          `Session cancelled by ${familyName}`,
          `<p><strong>${familyName}</strong> cancelled the session on <strong>${whenInfo}</strong>.</p>
           <p>Your other sessions in this series are unaffected.</p>
           <p><strong>Reason:</strong> ${reason}</p>
           ${latePolicyNote}
           <p style="margin-top: 16px;"><a href="https://sync-study.com/tutor" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>`,
        );
      }
      if (cancelPrefs?.push !== false) {
        await sendPushNotification(tutorUserId, title, body, {
          sessionId,
          instanceId,
          type: 'study_session_cancelled',
        });
      }
    } else {
      // Tutor cancelled → notify every parent in the family (cancelled prefs).
      const tutorName = (session.tutorName as string) || 'Your tutor';
      await notifyAllParents({
        familyId,
        prefCategory: 'cancelled',
        type: 'study_session_cancelled',
        title: 'Session cancelled',
        body: `${tutorName} cancelled the session on ${whenInfo}. Reason: ${reason}`,
        emailSubject: `Session cancelled — ${tutorName}`,
        emailBody: `<p><strong>${tutorName}</strong> cancelled the session on <strong>${whenInfo}</strong>.</p>
           <p>Your other sessions in this series are unaffected.</p>
           <p><strong>Reason:</strong> ${reason}</p>
           ${latePolicyNote}
           <p style="margin-top: 16px;"><a href="https://sync-study.com/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>`,
        data: { sessionId, instanceId },
      });
    }

    await writeUserActivity(uid, 'session_instance_cancelled', {
      sessionId,
      instanceId,
      reason,
      late,
    });

    return { success: true };
  },
);
