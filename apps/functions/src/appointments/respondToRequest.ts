import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

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

      // TODO: Send notification to family

    } else {
      // Decline
      await appointmentRef.update({
        status: 'rejected',
        statusReason: 'declined_by_babysitter',
        updatedAt: now,
      });

      // TODO: Send notification to family
    }

    await writeUserActivity(request.auth!.uid, data.action === 'accept' ? 'appointment_accepted' : 'appointment_declined', { appointmentId: data.appointmentId });

    return { success: true };
  }
);

function timeToSlotIndex(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return Math.floor((h * 60 + m) / 15);
}
