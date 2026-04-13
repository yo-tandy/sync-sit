import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';
import { notifyAllParents } from '../config/notifyParents.js';

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

    // Determine if caller is the babysitter or a parent
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerRole = callerDoc.data()?.role;
    let cancelledBy: string;

    if (callerRole === 'babysitter' && apt.babysitterUserId === uid) {
      cancelledBy = 'cancelled_by_babysitter';
    } else if (callerRole === 'parent') {
      const callerFamilyId = callerDoc.data()?.familyId;
      if (callerFamilyId === apt.familyId) {
        cancelledBy = 'cancelled_by_family';
      } else {
        throw new HttpsError('permission-denied', 'You are not part of this appointment');
      }
    } else {
      throw new HttpsError('permission-denied', 'You are not part of this appointment');
    }

    const now = new Date();

    // Update appointment
    await aptRef.update({
      status: 'cancelled',
      statusReason: cancelledBy,
      cancellationReason: reason.trim(),
      cancelledAt: now,
      updatedAt: now,
    });

    // Send notifications to the OTHER party
    if (cancelledBy === 'cancelled_by_family') {
      // Notify babysitter
      const babysitterDoc = await db.collection('users').doc(apt.babysitterUserId).get();
      const babysitterEmail = babysitterDoc.data()?.email;
      const babysitterPrefs = babysitterDoc.data()?.notifPrefs?.cancelled;
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

      if (babysitterPrefs?.email !== false && babysitterEmail) {
        await sendNotificationEmail(
          babysitterEmail,
          `Appointment cancelled by ${familyName}`,
          `<p><strong>${familyName}</strong> has cancelled the appointment for <strong>${dateInfo}</strong>.</p>
           <p><strong>Reason:</strong> ${reason.trim()}</p>
           <p style="margin-top: 16px;"><a href="https://sync-sit.com/babysitter" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Dashboard</a></p>`
        );
      }

      if (babysitterDoc.data()?.notifPrefs?.cancelled?.push !== false) {
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
        emailBody: `<p>The babysitter has cancelled the appointment for <strong>${dateInfo}</strong>.</p>
           <p><strong>Reason:</strong> ${reason.trim()}</p>
           <p style="margin-top: 16px;"><a href="https://sync-sit.com/family/search" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Search Babysitters</a></p>`,
        data: { appointmentId },
      });
    }

    await writeUserActivity(uid, cancelledBy, { appointmentId, reason: reason.trim() });

    return { success: true };
  }
);
