import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';

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

      // Block schedule if requested (one-time only)
      if (data.blockSchedule && appointment.date && appointment.startTime && appointment.endTime) {
        const startIdx = timeToSlotIndex(appointment.startTime);
        const endIdx = timeToSlotIndex(appointment.endTime);
        const slots = new Array(96).fill(false);
        // Mark the appointment time as unavailable (override)
        const overrideRef = db.collection('schedules').doc(uid)
          .collection('overrides').doc(appointment.date);

        const existingOverride = await overrideRef.get();
        if (existingOverride.exists && existingOverride.data()?.slots) {
          // Merge: mark requested slots as unavailable in existing override
          const existingSlots = [...existingOverride.data()!.slots];
          for (let i = startIdx; i < endIdx && i < 96; i++) {
            existingSlots[i] = false;
          }
          await overrideRef.update({ slots: existingSlots });
        } else {
          // Create unavailable override for this date
          await overrideRef.set({
            date: appointment.date,
            type: 'unavailable',
            reason: 'appointment',
            appointmentId: data.appointmentId,
            createdAt: now,
          });
        }
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
        const familyDoc = await db.collection('families').doc(appointment.familyId).get();
        const parentIds: string[] = familyDoc.data()?.parentIds || [];

        for (const parentId of parentIds) {
          const parentDoc = await db.collection('users').doc(parentId).get();
          const parentData = parentDoc.data();
          if (!parentData) continue;

          if (parentData.notifPrefs?.confirmed?.email !== false && parentData.email) {
            await sendNotificationEmail(
              parentData.email,
              `Babysitting confirmed — ${babysitterName}`,
              acceptEmailBody
            );
          }

          if (parentData.notifPrefs?.confirmed?.push !== false) {
            await sendPushNotification(
              parentId,
              'Babysitting confirmed',
              `${babysitterName} has accepted your babysitting request.`,
              { appointmentId: data.appointmentId, type: 'request_accepted' }
            );
          }

          await db.collection('notifications').add({
            recipientUserId: parentId,
            type: 'request_accepted',
            title: 'Babysitting confirmed',
            body: `${babysitterName} has accepted your babysitting request.`,
            data: { appointmentId: data.appointmentId },
            read: false,
            channels: ['email', 'push'],
            emailSent: parentData.notifPrefs?.confirmed?.email !== false,
            pushSent: false,
            createdAt: now,
          });
        }
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
        const familyDoc = await db.collection('families').doc(appointment.familyId).get();
        const parentIds: string[] = familyDoc.data()?.parentIds || [];

        for (const parentId of parentIds) {
          const parentDoc = await db.collection('users').doc(parentId).get();
          const parentData = parentDoc.data();
          if (!parentData) continue;

          if (parentData.notifPrefs?.cancelled?.email !== false && parentData.email) {
            await sendNotificationEmail(
              parentData.email,
              `Babysitting request declined — ${babysitterName}`,
              declineEmailBody
            );
          }

          if (parentData.notifPrefs?.cancelled?.push !== false) {
            await sendPushNotification(
              parentId,
              'Request declined',
              `${babysitterName} has declined your babysitting request.`,
              { appointmentId: data.appointmentId, type: 'request_declined' }
            );
          }

          await db.collection('notifications').add({
            recipientUserId: parentId,
            type: 'request_declined',
            title: 'Request declined',
            body: `${babysitterName} has declined your babysitting request.`,
            data: { appointmentId: data.appointmentId },
            read: false,
            channels: ['email', 'push'],
            emailSent: parentData.notifPrefs?.cancelled?.email !== false,
            pushSent: false,
            createdAt: now,
          });
        }
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
