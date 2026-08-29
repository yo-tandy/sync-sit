import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';

/**
 * Return dashboard counts: active babysitters, families, appointments,
 * pending verifications, and sync-do tasks (plan §9.4 — "task counts on the
 * admin dashboard", alongside the per-collection counts already here).
 */
export const getAdminDashboard = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const [
      babysitterSnap,
      familySnap,
      appointmentSnap,
      pendingVerSnap,
      taskSnap,
      openTaskSnap,
    ] = await Promise.all([
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
      // sync-do (§9.4). Both counts, because the totals answer different
      // questions: `doTaskCount` is the collection's size (it shrinks as the
      // retention sweep runs), `doOpenTaskCount` is what is live on the
      // board right now — the number an admin actually watches. An equality
      // filter needs no composite index.
      db.collection('doTasks').count().get(),
      db.collection('doTasks').where('status', '==', 'open').count().get(),
    ]);

    return {
      babysitterCount: babysitterSnap.data().count,
      familyCount: familySnap.data().count,
      appointmentCount: appointmentSnap.data().count,
      pendingVerificationCount: pendingVerSnap.data().count,
      doTaskCount: taskSnap.data().count,
      doOpenTaskCount: openTaskSnap.data().count,
    };
  }
);
