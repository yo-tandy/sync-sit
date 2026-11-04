import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';

/**
 * How long an `erasureStartedAt` marker is believed. Well past the callable's
 * timeout (`deleteUser`/`deleteMyAccount` run on the v2 default, 60s): an
 * erasure that started longer ago than this is not still running. If a
 * `timeoutSeconds` is ever set on those callables, keep this comfortably
 * above it.
 */
export const ERASURE_MARKER_TTL_MS = 15 * 60 * 1000;

/**
 * Whether an `erasureStartedAt` value marks an erasure that may still be in
 * flight.
 *
 * An unparseable value fails SAFE: treated as live, i.e. over-count the admin
 * as "on its way out" and refuse the destructive action, never the reverse.
 */
export function erasureMarkerIsLive(value: unknown, now: number): boolean {
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
 * Count the active admins that could still actually administer the platform,
 * INSIDE the caller's transaction.
 *
 * Shared by the two paths that can strand the platform with no usable admin —
 * erasure (`deleteUser`, issue #421) and blocking (`blockUser`, issue #500) —
 * so the two cannot drift apart. That drift is not hypothetical in this
 * codebase: #500 exists precisely because #490 closed the erasure hole and
 * left the identical one in `blockUser` open.
 *
 * MUST be called with the caller's `tx`, not a bare `db` read: two admins
 * acting on each other at the same moment both read "2 active admins" outside
 * a transaction and both proceed, leaving zero. Inside the transaction,
 * Firestore's optimistic concurrency retries one of them against the other's
 * committed write, so exactly one can win.
 *
 * A doc already mid-erasure (by a concurrent, still-in-flight call) is not a
 * REAL alternative admin — it is on its way out too. A marker older than the
 * TTL is an abandoned attempt, not an erasure in flight.
 */
export async function countEligibleActiveAdmins(
  tx: FirebaseFirestore.Transaction,
  now: number = Date.now(),
): Promise<number> {
  const activeAdmins = await tx.get(
    db.collection('users').where('isAdmin', '==', true).where('status', '==', 'active'),
  );
  return activeAdmins.docs.filter((d) => !erasureMarkerIsLive(d.data().erasureStartedAt, now))
    .length;
}

/**
 * Refuse an action that would remove the last usable admin.
 *
 * `{ code: 'admin/last-admin' }` is the contract the admin UI already maps to
 * a human message (`UsersPage.tsx`, added in #490) — keep the code stable.
 */
export function assertNotLastActiveAdmin(eligibleCount: number): void {
  if (eligibleCount <= 1) {
    throw new HttpsError(
      'failed-precondition',
      'You are the last active admin — appoint another admin first.',
      { code: 'admin/last-admin' },
    );
  }
}
