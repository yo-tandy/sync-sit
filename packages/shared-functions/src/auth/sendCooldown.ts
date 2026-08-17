import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

/**
 * Per-address resend cooldown for the signup verification callables (issue
 * #148 round 2): within this window a repeat request returns the fresh-path
 * success body without resending or rewriting anything. The check runs BEFORE
 * the account-existence branch and reads the verificationCodes doc that both
 * paths write (the silent path writes a decoy — see accountExistsNotice.ts),
 * so short-window repeats do identical work on both paths and stay
 * timing-symmetric. Legitimate "resend code" clicks after 60s still work.
 */
export const SEND_COOLDOWN_MS = 60 * 1000;

/** True when a verificationCodes/{email} doc exists and was created less than
 *  SEND_COOLDOWN_MS ago. */
export async function isInSendCooldown(email: string): Promise<boolean> {
  const doc = await db.collection('verificationCodes').doc(email).get();
  const createdAt = doc.data()?.createdAt;
  const createdMs =
    createdAt instanceof Timestamp
      ? createdAt.toMillis()
      : createdAt instanceof Date
        ? createdAt.getTime()
        : 0;
  return Date.now() - createdMs < SEND_COOLDOWN_MS;
}
