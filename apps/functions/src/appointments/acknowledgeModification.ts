import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';

export const acknowledgeModification = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const { appointmentId } = request.data as { appointmentId: string };

    if (!appointmentId) {
      throw new HttpsError('invalid-argument', 'Appointment ID is required');
    }

    const aptRef = db.collection('appointments').doc(appointmentId);
    const aptSnap = await aptRef.get();

    if (!aptSnap.exists) {
      throw new HttpsError('not-found', 'Appointment not found');
    }

    const apt = aptSnap.data()!;

    if (apt.babysitterUserId !== uid) {
      throw new HttpsError('permission-denied', 'Only the assigned babysitter can acknowledge modifications');
    }

    await aptRef.update({
      modified: false,
      modifiedFields: [],
      updatedAt: new Date(),
    });

    return { success: true };
  }
);
