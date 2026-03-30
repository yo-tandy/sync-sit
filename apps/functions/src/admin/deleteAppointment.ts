import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';

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

    await apptRef.update({
      status: 'cancelled',
      statusReason: 'admin_action',
    });

    // Create notification docs for both babysitter and family
    const notificationData = {
      type: 'appointment_cancelled',
      appointmentId,
      message: 'An appointment has been cancelled by an administrator.',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    };

    const notificationPromises: Promise<unknown>[] = [];

    if (apptData.babysitterId) {
      notificationPromises.push(
        db.collection('notifications').add({
          ...notificationData,
          userId: apptData.babysitterId,
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

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'delete_appointment',
      details: {
        appointmentId,
        babysitterId: apptData.babysitterId,
        familyId: apptData.familyId,
      },
    });

    return { success: true };
  }
);
