import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

/**
 * signOutEverywhere — cross-app session coherence (issue #181).
 *
 * Sessions are per-origin, so sync/sit and sync/study can drift apart (log
 * out of one, the other stays signed in). "Log out" means log out EVERYWHERE:
 *
 * 1. Bump the server-owned users/{uid}.sessionEpoch (a server timestamp).
 *    Both apps capture the epoch at sign-in and watch the user doc live;
 *    a NEWER epoch than the one they captured force-signs them out.
 * 2. Revoke refresh tokens as the backstop — any client that misses the
 *    doc watch (closed tab, lost connection) dies when its ID token next
 *    needs a refresh (within the hour).
 *
 * No input args. Auth required — you can only sign yourself out.
 */
export const signOutEverywhere = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    // set+merge, not update: resilient to a missing user doc (the auth
    // session still gets revoked below either way).
    await db
      .collection('users')
      .doc(uid)
      .set({ sessionEpoch: FieldValue.serverTimestamp() }, { merge: true });
    await adminAuth.revokeRefreshTokens(uid);
    await writeUserActivity(uid, 'signed_out_everywhere', {});

    return { ok: true };
  },
);
