import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

/**
 * Single-use enforcement for co-parent invite links, as a short lease.
 *
 * THE DEFECT THIS REPLACES. joinFamily read `used` at the top and wrote it at
 * the bottom, with Auth account creation, the user-doc write and the
 * `parentIds` arrayUnion in between, and no transaction anywhere. Two
 * redemptions of one link that overlapped in that window BOTH passed the check
 * and BOTH joined the family. A co-parent link is single-use by policy, and
 * family membership carries the family's kids, address and appointments — so
 * the extra member is an access grant, not a bookkeeping slip.
 *
 * WHY A LEASE AND NOT JUST AN EARLIER CONSUME. The consume cannot simply move
 * to the front: joinFamily's ordering is load-bearing, so that a FAILED
 * attempt (a wrong verification code, an email already registered, the
 * profile-exists rejection) leaves the link usable for a legitimate retry.
 * A lease keeps both properties — `claim` excludes a concurrent redemption,
 * `release` restores the link the moment an attempt fails, and `consume` only
 * burns it once the join has actually happened.
 *
 * WHY THE TTL. The one path that cannot release is an invocation that dies
 * holding a claim. The TTL bounds that: the lease goes stale and the link
 * becomes takeable again, rather than being lost forever.
 *
 * WHY EVERY STEP IS A TRANSACTION. Exclusion is by construction — Firestore
 * serializes transactions contending on the same document. An emulator test
 * cannot deterministically race two redemptions (verified: making the claim a
 * plain read-then-write leaves the whole integration suite green), so the unit
 * pins in `__tests__/inviteClaim.test.ts` lock the wiring itself: reads via
 * `tx.get`, writes via `tx.update`, never `ref.get`/`ref.update`.
 */

/**
 * How long a redemption may hold an unfinished claim.
 *
 * Only reached when an invocation dies between claiming and releasing — every
 * ordinary failure releases explicitly. Two minutes is far longer than a
 * redemption (one Auth create plus three small writes) and short enough that a
 * co-parent who hits the crash window can simply try again.
 */
export const INVITE_CLAIM_TTL_MS = 2 * 60 * 1000;

/** A claim id unique to one redemption attempt. */
export function newClaimId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Take the lease, returning the invite's familyId. Throws the caller-facing
 * rejection for a missing, used, expired, or currently-claimed link.
 */
export async function claimInvite(
  inviteRef: FirebaseFirestore.DocumentReference,
  claimId: string,
  now: Date = new Date(),
): Promise<string> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(inviteRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Invalid invite link');
    }
    const invite = snap.data()!;
    if (invite.used) {
      throw new HttpsError('failed-precondition', 'This invite link has already been used');
    }
    if (invite.expiresAt.toDate() < now) {
      throw new HttpsError('deadline-exceeded', 'This invite link has expired');
    }
    // A live claim means another redemption is in flight. Same message as
    // `used`: from the caller's side the link is taken, and "try again in a
    // moment" would invite exactly the retry that races.
    const claimedAt: FirebaseFirestore.Timestamp | undefined = invite.claimedAt;
    if (claimedAt && now.getTime() - claimedAt.toDate().getTime() < INVITE_CLAIM_TTL_MS) {
      throw new HttpsError('failed-precondition', 'This invite link has already been used');
    }
    tx.update(inviteRef, { claimedAt: now, claimId });
    return invite.familyId as string;
  });
}

/**
 * Burn the link — conditional on the claim still being OURS. If our lease
 * expired and another redemption took over, this invocation must not stamp
 * itself as the user of a link somebody else is now redeeming.
 */
export async function consumeInviteClaim(
  inviteRef: FirebaseFirestore.DocumentReference,
  claimId: string,
  uid: string,
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(inviteRef);
    if (!snap.exists || snap.data()!.claimId !== claimId) {
      throw new HttpsError('failed-precondition', 'This invite link has already been used');
    }
    tx.update(inviteRef, {
      used: true,
      usedByUserId: uid,
      claimedAt: FieldValue.delete(),
      claimId: FieldValue.delete(),
    });
  });
}

/**
 * Give the link back after a failed attempt — also conditional on ownership,
 * so a rejected redemption never releases a lease it does not hold.
 *
 * Best-effort: on failure the claim simply expires after the TTL, so the link
 * is never permanently lost, and the caller's real error (a wrong code, say)
 * is never replaced by a cleanup failure.
 */
export async function releaseInviteClaim(
  inviteRef: FirebaseFirestore.DocumentReference,
  claimId: string,
): Promise<void> {
  await db
    .runTransaction(async (tx) => {
      const snap = await tx.get(inviteRef);
      if (!snap.exists || snap.data()!.claimId !== claimId) return;
      tx.update(inviteRef, {
        claimedAt: FieldValue.delete(),
        claimId: FieldValue.delete(),
      });
    })
    .catch(() => {});
}
