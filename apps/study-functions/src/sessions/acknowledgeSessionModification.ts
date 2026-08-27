import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { acknowledgeSessionModificationSchema } from '../validation/session.js';

/**
 * acknowledgeSessionModification (issue #234): the TUTOR marks a family's
 * modification as seen — sit's acknowledgeModification twin. Clearing
 * `modified` IS the acknowledgement (there is no separate acknowledged flag,
 * matching sit); the UI badges the session until this runs. Deliberately
 * silent: sit's ack sends no notification, and the family's own change needs
 * no echo.
 */
export const acknowledgeSessionModification = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const parsed = acknowledgeSessionModificationSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { sessionId } = parsed.data;

    const sessionRef = db.collection('study-sessions').doc(sessionId);
    const snap = await sessionRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Session not found');
    }
    if (snap.data()!.tutorUserId !== uid) {
      throw new HttpsError('permission-denied', 'Only the session tutor can acknowledge modifications');
    }

    await sessionRef.update({ modified: false, modifiedFields: [], updatedAt: new Date() });
    await writeUserActivity(uid, 'session_modification_acknowledged', { sessionId });
    return { success: true };
  },
);
