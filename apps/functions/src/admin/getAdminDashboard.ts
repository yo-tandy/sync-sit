import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';

/**
 * Return dashboard counts: active babysitters, families, appointments.
 */
export const getAdminDashboard = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const [babysitterSnap, familySnap, appointmentSnap] = await Promise.all([
      db
        .collection('users')
        .where('role', '==', 'babysitter')
        .where('status', '==', 'active')
        .count()
        .get(),
      db.collection('families').count().get(),
      db.collection('appointments').count().get(),
    ]);

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'view_dashboard',
    });

    return {
      babysitterCount: babysitterSnap.data().count,
      familyCount: familySnap.data().count,
      appointmentCount: appointmentSnap.data().count,
    };
  }
);
