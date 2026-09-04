import { db } from '../config/firebase.js';

/**
 * The counters `eraseUserAccount` returns that describe a PARTIAL erasure.
 * Both are per-item isolated failures: the erasure carried on past them, so
 * the account is gone and personal data is not.
 */
export interface ErasureFailureCounts {
  studyErasure: { cascadeErrors: number };
  claimReleaseErrors: number;
  now: Date;
}

/**
 * Raise the `partial_user_erasure` alert when an erasure left data behind.
 *
 * Shared by both callables deliberately. The number is the ONLY alarm there
 * is: the user document and the Auth account are already gone by the time it
 * is computed, so the erasure cannot simply be re-run, and a silent skip
 * leaves un-anonymized personal data with nobody aware of it. Two copies of
 * that logic would eventually disagree about when to fire — and the copy that
 * drifts is the one that stays quiet.
 *
 * `selfDeleted` marks which path produced it. The two need different
 * follow-up: an admin delete has a human who can be asked what happened, a
 * self-delete has nobody.
 *
 * Returns the total, for the caller's audit entry and admin email — so the
 * number written to the trail and the condition that raises the alert can
 * never disagree.
 */
export async function raisePartialErasureAlert(
  targetUserId: string,
  erased: ErasureFailureCounts,
  selfDeleted: boolean,
): Promise<number> {
  const erasureFailures = erased.studyErasure.cascadeErrors + erased.claimReleaseErrors;
  if (erasureFailures > 0) {
    await db.collection('adminAlerts').add({
      type: 'partial_user_erasure',
      createdAt: erased.now,
      data: {
        targetUserId,
        studySessionCascadeErrors: erased.studyErasure.cascadeErrors,
        claimReleaseErrors: erased.claimReleaseErrors,
        selfDeleted,
      },
    });
  }
  return erasureFailures;
}
