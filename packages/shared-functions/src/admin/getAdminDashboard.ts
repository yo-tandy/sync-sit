import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';

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

    const [babysitterSnap, familySnap, appointmentSnap, pendingVerSnap] = await Promise.all([
      // Plan D: a doc carrying profiles.babysitter.enrollmentComplete (always
      // a boolean on any babysitter profile) is a babysitter, regardless of
      // value — `in [true,false]` acts as an existence predicate. Equality/in
      // filters need no composite index.
      db
        .collection('users')
        .where('status', '==', 'active')
        .where('profiles.babysitter.enrollmentComplete', 'in', [true, false])
        .count()
        .get(),
      db.collection('families').count().get(),
      db.collection('appointments').count().get(),
      db.collection('verifications')
        .where('status', '==', 'pending')
        .count()
        .get(),
    ]);

    return {
      babysitterCount: babysitterSnap.data().count,
      familyCount: familySnap.data().count,
      appointmentCount: appointmentSnap.data().count,
      pendingVerificationCount: pendingVerSnap.data().count,
    };
  }
);
