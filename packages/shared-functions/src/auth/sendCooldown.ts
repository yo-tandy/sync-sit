import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getConfigValue } from '../config/adminConfig.js';

/**
 * Per-address resend cooldown for the signup verification callables (issue
 * #148 round 2): within this window a repeat request returns the fresh-path
 * success body without resending or rewriting anything. The check runs BEFORE
 * the account-existence branch and reads the verificationCodes doc that both
 * paths write (the silent path writes a decoy — see accountExistsNotice.ts),
 * so short-window repeats do identical work on both paths and stay
 * timing-symmetric. Legitimate "resend code" clicks after 60s still work.
 */
// Admin-configurable since issue #250: the window is
// getConfigValue('verificationCodeCooldownS') -- default and bounds live in
// shared-core's ADMIN_CONFIG_DEFS (the old fixed 60s is that key's default
// AND its floor).

/** True when a verificationCodes/{email} doc exists and was created less
 *  than the configured cooldown ago.
 *
 *  Identity-class agnostic on purpose (issue #322 audit): the cooldown is a
 *  per-ADDRESS send budget shared by both issuing callables, and grading it
 *  by class would give one address two independent cooldowns to burn — a
 *  widening. It grants nothing; the enroll callables grade the class. */
export async function isInSendCooldown(email: string): Promise<boolean> {
  const doc = await db.collection('verificationCodes').doc(email).get();
  const createdAt = doc.data()?.createdAt;
  const createdMs =
    createdAt instanceof Timestamp
      ? createdAt.toMillis()
      : createdAt instanceof Date
        ? createdAt.getTime()
        : 0;
  const cooldownMs = (await getConfigValue('verificationCodeCooldownS')) * 1000;
  return Date.now() - createdMs < cooldownMs;
}
