import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import { escapeHtml, sendNotificationEmail } from '../config/email.js';
import { SIT_APP_URL } from '@ejm/shared-functions';
import type { SessionBlockEntry } from '@ejm/shared-functions/schedule/sessionOverride.js';
import { createClaimReleaser, SIT_PROVENANCE } from '../scheduled/retentionClaims.js';

interface DeleteAppointmentInput {
  appointmentId: string;
}

/**
 * Permanently delete an appointment and notify both babysitter and family.
 *
 * (The docblock used to say "set status to 'cancelled', reason to
 * 'admin_action'". It never did that — the document is hard-deleted, and has
 * been since this callable shipped. Corrected while fixing what that mismatch
 * hid.)
 */
export const deleteAppointment = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { appointmentId } = request.data as DeleteAppointmentInput;

    if (!appointmentId) {
      throw new HttpsError('invalid-argument', 'appointmentId is required');
    }

    const apptRef = db.collection('appointments').doc(appointmentId);
    const apptDoc = await apptRef.get();

    if (!apptDoc.exists) {
      throw new HttpsError('not-found', 'Appointment not found');
    }

    const apptData = apptDoc.data()!;

    // ── Release the babysitter's schedule claim (issue #408 item 4) ──
    //
    // Confirming an appointment AND-blocks the sitter's
    // `schedules/{uid}/overrides/{date}` slots and appends a `sessionBlocks`
    // ledger entry naming this appointment (`respondToRequest`).
    // `cancelAppointment` gives those slots back through the shared lossless
    // inverse; THIS path never did. So an admin delete removed the appointment
    // and left the claim: the sitter's slot stayed unavailable forever, with
    // nothing left in the system pointing at it — invisible in the UI, and
    // unrecoverable without a manual Firestore edit, because the only thing
    // that could have released it is the document that was just deleted.
    //
    // `createClaimReleaser` is the SAME wrapper the retention sweeps use
    // (PR #396) over `buildRestoredOverride`, the one lossless inverse shared
    // by every cancel path in both apps. Reused, not reimplemented: a second
    // copy is how the claim paths drift. It conserves a cross-app STUDY claim
    // on the same date, leaves a legacy pre-ledger override untouched, and
    // deletes the override doc outright when this claim was the only thing on
    // it (the day reverts to the bare weekly grid).
    //
    // ORDER: release BEFORE the delete, and let a failure propagate. This is
    // the retention sweeps' discipline and the opposite of `cancelAppointment`'s
    // — deliberately, because the failure modes are opposite. Here the document
    // is DELETED, so releasing after and failing would strand a ledger entry
    // naming a document that no longer exists, with nothing able to collect it
    // ever again. Releasing first and failing leaves the appointment and the
    // claim both intact and consistent, and the admin simply retries. A
    // released claim on a still-present appointment (the window between the two
    // writes) is the recoverable direction: it reopens a slot the admin is in
    // the act of freeing anyway.
    //
    // The predicate is the LEDGER ENTRY, deliberately not the status. Only a
    // confirmed appointment with a concrete date ever claims slots — a pending
    // request claims nothing, and a confirmed RECURRING arrangement stores
    // `date: null` and blocks no override (`respondToRequest` gates its
    // schedule write on the same pair) — so a `status === 'confirmed'` guard
    // here would be unreachable-by-construction on every healthy document, and
    // on an UNhealthy one it would do harm: an appointment whose claim was
    // never released at cancel (exactly what item 1 of this issue found
    // `deleteUser` doing) is `cancelled` and still holds a ledger entry, and
    // that is precisely the claim an admin delete should collect. Matching the
    // entry by `appointmentId` is both the precise test and the safe one —
    // `releaseClaim` no-ops when the override doc, or an entry naming this
    // appointment, is absent. The `date` check is needed for real: a recurring
    // doc has no date to key an override on.
    let claimReleased = false;
    if (
      typeof apptData.date === 'string' &&
      apptData.date &&
      typeof apptData.babysitterUserId === 'string' &&
      apptData.babysitterUserId
    ) {
      const releaseClaim = createClaimReleaser(db, new Date());
      claimReleased = await releaseClaim(
        apptData.babysitterUserId,
        apptData.date,
        (b: SessionBlockEntry) => b.appointmentId === appointmentId,
        SIT_PROVENANCE,
      );
    }

    // Delete the appointment document permanently
    await apptRef.delete();

    // Create notification docs for both babysitter and family
    const notificationData = {
      type: 'appointment_cancelled',
      appointmentId,
      message: 'An appointment has been cancelled by an administrator.',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    };

    const notificationPromises: Promise<unknown>[] = [];

    if (apptData.babysitterUserId) {
      notificationPromises.push(
        db.collection('notifications').add({
          ...notificationData,
          userId: apptData.babysitterUserId,
        })
      );
    }

    if (apptData.familyId) {
      notificationPromises.push(
        db.collection('notifications').add({
          ...notificationData,
          userId: apptData.familyId,
        })
      );
    }

    await Promise.all(notificationPromises);

    // Send email notifications to babysitter and family parents
    const dateInfo = apptData.date
      ? `${apptData.date}${apptData.startTime ? `, ${apptData.startTime}` : ''}${apptData.endTime ? `–${apptData.endTime}` : ''}`
      : 'Recurring';

    if (apptData.babysitterUserId) {
      try {
        const babysitterDoc = await db.collection('users').doc(apptData.babysitterUserId).get();
        const babysitterEmail = babysitterDoc.data()?.email;
        if (babysitterEmail) {
          await sendNotificationEmail(
            babysitterEmail,
            'Appointment cancelled by admin',
            `<p>An administrator has cancelled your appointment for <strong>${escapeHtml(dateInfo)}</strong>.</p>
             <p>If you have questions, please contact support.</p>
             <p style="margin-top: 16px;"><a href="${SIT_APP_URL}/babysitter" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Dashboard</a></p>`
          );
        }
      } catch (err) {
        console.error('Failed to send cancellation email to babysitter:', err);
      }
    }

    if (apptData.familyId) {
      try {
        const familyDoc = await db.collection('families').doc(apptData.familyId).get();
        const parentIds: string[] = familyDoc.data()?.parentIds || [];
        for (const parentId of parentIds) {
          const parentDoc = await db.collection('users').doc(parentId).get();
          const parentEmail = parentDoc.data()?.email;
          if (parentEmail) {
            await sendNotificationEmail(
              parentEmail,
              'Appointment cancelled by admin',
              `<p>An administrator has cancelled your appointment for <strong>${escapeHtml(dateInfo)}</strong>.</p>
               <p>If you have questions, please contact support.</p>
               <p style="margin-top: 16px;"><a href="${SIT_APP_URL}/family/search" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Search Babysitters</a></p>`
            );
          }
        }
      } catch (err) {
        console.error('Failed to send cancellation email to family:', err);
      }
    }

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'delete_appointment',
      details: {
        appointmentId,
        babysitterUserId: apptData.babysitterUserId || null,
        familyId: apptData.familyId || null,
        // issue #408 item 4: whether this delete actually reopened slots.
        // False for a pending/recurring doc (nothing was ever claimed) and for
        // a legacy override with no ledger entry to match.
        scheduleClaimReleased: claimReleased,
      },
    });

    return { success: true };
  }
);
