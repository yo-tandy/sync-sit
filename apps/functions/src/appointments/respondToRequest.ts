import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { notifyAllParents } from '../config/notifyParents.js';
import { buildMergedOverride } from '@ejm/shared-functions/schedule/sessionOverride.js';

/** sit stamps the override docs it creates so its cancel can restore losslessly. */
const SIT_PROVENANCE = { appSource: 'sit', reason: 'appointment' } as const;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface RespondData {
  appointmentId: string;
  action: 'accept' | 'decline';
  blockSchedule?: boolean;
}

export const respondToRequest = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const data = request.data as RespondData;

    if (!data.appointmentId || !data.action) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const appointmentRef = db.collection('appointments').doc(data.appointmentId);
    const appointmentSnap = await appointmentRef.get();

    if (!appointmentSnap.exists) {
      throw new HttpsError('not-found', 'Appointment not found');
    }

    const appointment = appointmentSnap.data()!;

    // Verify the caller is the babysitter for this appointment
    if (appointment.babysitterUserId !== uid) {
      throw new HttpsError('permission-denied', 'You are not the babysitter for this appointment');
    }

    console.log(`[respondToRequest] aptId=${data.appointmentId} action=${data.action} status=${appointment.status} familyId=${appointment.familyId}`);

    if (appointment.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'This appointment is no longer pending');
    }

    const now = new Date();

    if (data.action === 'accept') {
      await appointmentRef.update({
        status: 'confirmed',
        confirmedAt: now,
        updatedAt: now,
      });

      // Block schedule if requested (one-time only). The claim ANDs the
      // appointment's slots to false in the babysitter's date override AND
      // records a restorable `sessionBlocks` ledger entry (buildMergedOverride,
      // shared with study). This makes the claim per-slot (not a whole-day
      // 'unavailable' block) and lossslessly reversible by cancelAppointment, and
      // lets it coexist with a study claim in one doc for a dual-role uid.
      if (data.blockSchedule && appointment.date && appointment.startTime && appointment.endTime) {
        const startIdx = timeToSlotIndex(appointment.startTime);
        const endIdx = timeToSlotIndex(appointment.endTime);
        const scheduleRef = db.collection('schedules').doc(uid);
        const overrideRef = scheduleRef.collection('overrides').doc(appointment.date);

        // The babysitter's weekly grid for this date's weekday is the merge base
        // for a day with no prior override (mirrors searchBabysitters' day-key
        // derivation). Static config → read once, outside the override tx.
        const scheduleSnap = await scheduleRef.get();
        const dayKey = DAY_KEYS[new Date(`${appointment.date}T00:00:00`).getDay()];
        const weeklySlots: boolean[] = scheduleSnap.data()?.weekly?.[dayKey] ?? [];

        await db.runTransaction(async (tx) => {
          const snap = await tx.get(overrideRef);
          const existing = snap.exists ? snap.data()! : null;
          const merged = buildMergedOverride({
            existing,
            date: appointment.date,
            weeklySlots,
            block: { start: startIdx, end: endIdx },
            entry: { appointmentId: data.appointmentId, startIdx, endIdx },
            ownProvenance: SIT_PROVENANCE,
            now,
          });
          tx.set(overrideRef, merged);
        });
      }

      // Send confirmation notification to family
      const babysitterDoc = await db.collection('users').doc(uid).get();
      const babysitterUser = babysitterDoc.data()!;
      const babysitterName = `${babysitterUser.firstName} ${babysitterUser.lastName}`;

      const dateDisplay = appointment.date
        ? `${appointment.date}${appointment.startTime ? ` at ${appointment.startTime}` : ''}${appointment.endTime ? `–${appointment.endTime}` : ''}`
        : 'Recurring schedule';

      const contactInfo = babysitterUser.email
        ? `<p><strong>Email:</strong> ${babysitterUser.email}</p>`
        : '';
      const phoneInfo = babysitterUser.phone
        ? `<p><strong>Phone:</strong> ${babysitterUser.phone}</p>`
        : '';

      const acceptEmailBody = `
        <p><strong>${babysitterName}</strong> has accepted your babysitting request for <strong>${dateDisplay}</strong>.</p>
        ${contactInfo}
        ${phoneInfo}
        <p style="margin-top: 16px;"><a href="https://sync-sit.com/family" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
      `;

      if (appointment.familyId) {
        await notifyAllParents({
          familyId: appointment.familyId,
          prefCategory: 'confirmed',
          type: 'request_accepted',
          title: 'Babysitting confirmed',
          body: `${babysitterName} has accepted your babysitting request.`,
          emailSubject: `Babysitting confirmed — ${babysitterName}`,
          emailBody: acceptEmailBody,
          data: { appointmentId: data.appointmentId },
        });
      }

    } else {
      // Decline
      await appointmentRef.update({
        status: 'rejected',
        statusReason: 'declined_by_babysitter',
        updatedAt: now,
      });

      // Load babysitter name for notification
      const babysitterDoc = await db.collection('users').doc(uid).get();
      const babysitterUser = babysitterDoc.data()!;
      const babysitterName = `${babysitterUser.firstName} ${babysitterUser.lastName}`;

      const declineDateDisplay = appointment.date
        ? `${appointment.date}${appointment.startTime ? ` at ${appointment.startTime}` : ''}${appointment.endTime ? `–${appointment.endTime}` : ''}`
        : 'Recurring schedule';

      const declineEmailBody = `
        <p><strong>${babysitterName}</strong> has declined your babysitting request for <strong>${declineDateDisplay}</strong>.</p>
        <p>You can search for other available babysitters or resubmit this request with updated details.</p>
        <p style="margin-top: 16px;"><a href="https://sync-sit.com/family" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
      `;

      if (appointment.familyId) {
        await notifyAllParents({
          familyId: appointment.familyId,
          prefCategory: 'cancelled',
          type: 'request_declined',
          title: 'Request declined',
          body: `${babysitterName} has declined your babysitting request.`,
          emailSubject: `Babysitting request declined — ${babysitterName}`,
          emailBody: declineEmailBody,
          data: { appointmentId: data.appointmentId },
        });
      }
    }

    await writeUserActivity(request.auth!.uid, data.action === 'accept' ? 'appointment_accepted' : 'appointment_declined', { appointmentId: data.appointmentId });

    return { success: true };
  }
);

function timeToSlotIndex(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return Math.floor((h * 60 + m) / 15);
}
