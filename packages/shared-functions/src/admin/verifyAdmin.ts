import { HttpsError } from 'firebase-functions/v2/https';
import { isAdmin, type User } from '@ejm/shared-core';
import { db } from '../config/firebase.js';

/**
 * Verify that the given uid belongs to a user with role 'admin'.
 * Throws HttpsError('permission-denied') if not.
 */
export async function verifyAdmin(uid: string): Promise<void> {
  const userDoc = await db.collection('users').doc(uid).get();

  if (!isAdmin(userDoc.data() as User | undefined)) {
    throw new HttpsError('permission-denied', 'Admin access required');
  }
}
