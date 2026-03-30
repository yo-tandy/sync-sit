import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';

/**
 * Verify that the given uid belongs to a user with role 'admin'.
 * Throws HttpsError('permission-denied') if not.
 */
export async function verifyAdmin(uid: string): Promise<void> {
  const userDoc = await db.collection('users').doc(uid).get();

  if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required');
  }
}
