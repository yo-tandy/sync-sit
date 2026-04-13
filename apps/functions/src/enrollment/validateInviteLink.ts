import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';

/**
 * Validates an invite link token and returns the family name.
 * This is a public-facing proxy so that inviteLinks documents
 * don't need a permissive Firestore read rule.
 */
export const validateInviteLink = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const { token } = request.data as { token: string };

    if (!token || typeof token !== 'string') {
      throw new HttpsError('invalid-argument', 'Missing token');
    }

    const inviteSnap = await db.collection('inviteLinks').doc(token).get();
    if (!inviteSnap.exists) {
      throw new HttpsError('not-found', 'Invalid invite link');
    }

    const invite = inviteSnap.data()!;

    if (invite.used) {
      throw new HttpsError('failed-precondition', 'This invite link has already been used');
    }

    if (invite.expiresAt.toDate() < new Date()) {
      throw new HttpsError('deadline-exceeded', 'This invite link has expired');
    }

    return { familyName: invite.familyName || '' };
  }
);
