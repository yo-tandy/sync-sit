import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';

/**
 * "Never leave the platform with zero usable admins" -- the count and the
 * refusal, shared by every callable that can take an admin out of service:
 * `eraseUserAccount` (issue #421 -- both `deleteUser` and `deleteMyAccount`)
 * and `blockUser` (issue #500: a blocked admin's Auth account is disabled in
 * the same call, so they cannot sign back in to undo it -- the same lockout
 * as erasure, recoverable only from the console).
 *
 * ALWAYS called inside the caller's transaction, and the caller must write
 * its own change to the target inside that SAME transaction. That is what
 * makes the count race-proof: two admins acting on each other at once both
 * read every active-admin doc here, so whichever commits first changes a doc
 * the other one read, Firestore retries the second, and its recount sees the
 * first one's write. A read-only check with the write committed afterwards
 * lets both see a stale count of two and both pass.
 */

/**
 * How long an `erasureStartedAt` marker is believed. Well past the callable's
 * timeout (`deleteUser`/`deleteMyAccount` run on the v2 default, 60s): an
 * erasure that started longer ago than this is not still running. If a
 * `timeoutSeconds` is ever set on those callables, keep this comfortably
 * above it.
 */
export const ERASURE_MARKER_TTL_MS = 15 * 60 * 1000;

/** Whether an `erasureStartedAt` value marks an erasure that may still be in flight. */
function erasureMarkerIsLive(value: unknown, now: number): boolean {
  if (value == null) return false;
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof (value as { toMillis?: unknown }).toMillis === 'function'
        ? (value as { toMillis: () => number }).toMillis()
        : NaN;
  if (!Number.isFinite(ms)) return true;
  return now - ms < ERASURE_MARKER_TTL_MS;
}

/**
 * Active admins that are REAL alternatives right now: `isAdmin == true`,
 * `status == 'active'`, and not carrying a live `erasureStartedAt` marker (a
 * doc mid-erasure by a concurrent call is on its way out too). A marker older
 * than the TTL is an abandoned attempt and that admin counts again -- only
 * `eraseUserAccount`'s catch ever clears the marker, so a process killed
 * outright between its commit and that catch would otherwise under-count
 * real admins by one forever. In-memory on the docs the query already
 * returned: no extra index, no cron. A marker that cannot be read as a time
 * fails SAFE (treated as live: over-block, never lock out).
 */
export async function countEligibleActiveAdmins(tx: FirebaseFirestore.Transaction): Promise<number> {
  const activeAdmins = await tx.get(
    db.collection('users').where('isAdmin', '==', true).where('status', '==', 'active'),
  );
  const now = Date.now();
  return activeAdmins.docs.filter((d) => !erasureMarkerIsLive(d.data().erasureStartedAt, now)).length;
}

/**
 * The refusal. `details.code` is the contract the clients map to copy
 * (`UsersPage.tsx`, `accountDeleteErrorCode` in shared-ui); the message is
 * for logs and for callers with no mapping.
 */
export function lastAdminError(message: string): HttpsError {
  return new HttpsError('failed-precondition', message, { code: 'admin/last-admin' });
}
