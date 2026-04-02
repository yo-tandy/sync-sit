import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';

/**
 * Add a pre-approved email for test/invite babysitter accounts.
 */
export const addPreapprovedEmail = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { email } = request.data as { email: string };

    if (!email) {
      throw new HttpsError('invalid-argument', 'Email is required');
    }

    const normalizedEmail = email.toLowerCase();

    await db.collection('preapprovedEmails').doc(normalizedEmail).set({
      email: normalizedEmail,
      createdByAdminId: request.auth.uid,
      createdAt: new Date(),
      used: false,
    });

    return { success: true };
  }
);

/**
 * Remove a pre-approved email.
 */
export const removePreapprovedEmail = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { email } = request.data as { email: string };

    if (!email) {
      throw new HttpsError('invalid-argument', 'Email is required');
    }

    await db.collection('preapprovedEmails').doc(email.toLowerCase()).delete();

    return { success: true };
  }
);

/**
 * List all pre-approved emails.
 */
export const listPreapprovedEmails = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const snapshot = await db.collection('preapprovedEmails').get();

    const emails = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        email: data.email,
        used: data.used,
        createdAt: data.createdAt,
      };
    });

    return { emails };
  }
);
