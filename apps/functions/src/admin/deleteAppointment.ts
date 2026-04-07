import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import { sendNotificationEmail } from '../config/email.js';

interface DeleteAppointmentInput {
  appointmentId: string;
}

/**
 * Cancel an appointment (set status to 'cancelled', reason to 'admin_action')
 * and notify both babysitter and family.
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
            `<p>An administrator has cancelled your appointment for <strong>${dateInfo}</strong>.</p>
             <p>If you have questions, please contact support.</p>
             <p style="margin-top: 16px;"><a href="https://sync-sit.com/babysitter" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Dashboard</a></p>`
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
              `<p>An administrator has cancelled your appointment for <strong>${dateInfo}</strong>.</p>
               <p>If you have questions, please contact support.</p>
               <p style="margin-top: 16px;"><a href="https://sync-sit.com/family/search" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Search Babysitters</a></p>`
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
      },
    });

    return { success: true };
  }
);
