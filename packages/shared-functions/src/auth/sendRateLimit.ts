import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

/**
 * Send-volume caps for the signup verification callables (issue #155). Two
 * independent budgets, both tracked in the server-only
 * verificationSendCounters collection (clients cannot reach it:
 * firestore.rules has no match for the collection, so the default-deny
 * catch-all applies — same posture as accountExistsNotices):
 *
 * 1. Per-ADDRESS daily cap — DAILY_SEND_CAP sends per email per 24h window,
 *    shared across verifyEjmEmail + verifyParentEmail (one counter doc keyed
 *    by the normalized address). When it trips, the callables go SILENT: the
 *    response body stays byte-identical to the fresh success and nothing is
 *    written or refreshed — any error here would be a new abuse/enumeration
 *    oracle (see the #148/#154 silent-path design). The mailbox owner simply
 *    stops receiving mail until the window rolls over.
 *
 * 2. Per-UID bypass allowance — BYPASS_SEND_CAP sends per uid per hour for
 *    the authed own-email bypass in verifyEjmEmail (the #154 residual: the
 *    bypass is deliberately exempt from the 60s cooldown AND from the
 *    per-address cap — a prober burning either would otherwise starve the
 *    owner's cross-app enrollment — which left it with no server-side limit
 *    at all). Unlike the address cap this one throws an explicit
 *    failed-precondition: the caller is authenticated and operating on their
 *    OWN account, so there is nothing to enumerate and a clear error beats
 *    silent mail loss.
 *
 * Windows are FIXED, anchored at the first send: a capped request does not
 * write (no sliding lockout), so the budget always frees up windowMs after
 * the window's first send.
 */
export const DAILY_SEND_CAP = 10;
export const DAILY_SEND_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BYPASS_SEND_CAP = 6;
export const BYPASS_SEND_WINDOW_MS = 60 * 60 * 1000;

export const SEND_COUNTERS_COLLECTION = 'verificationSendCounters';

export interface SendCounterWrite {
  count: number;
  windowStart: Date;
}

/**
 * Pure window arithmetic: given the stored counter doc (if any), decide
 * whether another send fits the budget.
 *
 * @returns the counter state to persist for an allowed send (count 1 with a
 *   fresh anchor when no live window exists, otherwise count+1 preserving the
 *   anchor), or null when the cap is already spent — the caller must not send
 *   and must not write.
 *
 * Malformed or missing fields read as "no live window" (fresh count 1):
 * fail-open by one send beats a permanently wedged address.
 */
export function nextSendCounter(
  existing: { count?: unknown; windowStart?: unknown } | undefined,
  nowMs: number,
  cap: number,
  windowMs: number,
): SendCounterWrite | null {
  const windowStart = existing?.windowStart;
  const startMs =
    windowStart instanceof Timestamp
      ? windowStart.toMillis()
      : windowStart instanceof Date
        ? windowStart.getTime()
        : 0;
  const count = typeof existing?.count === 'number' ? existing.count : 0;

  const windowLive = startMs > 0 && count > 0 && nowMs - startMs < windowMs;
  if (!windowLive) {
    return { count: 1, windowStart: new Date(nowMs) };
  }
  if (count >= cap) {
    return null;
  }
  return { count: count + 1, windowStart: new Date(startMs) };
}

/**
 * Read-decide-write against one counter doc, inside a single-doc
 * runTransaction so the cap is EXACT (PR #180 review): with a plain get/set,
 * N concurrent requests would all read the same count and all pass, making
 * the real bound "cap bursts" with attacker-chosen burst width. The
 * transaction serializes contenders on the one doc — contention is scoped
 * per-address (legitimate traffic to one address is already serialized by
 * the 60s cooldown), and the capped branch still writes nothing, so the
 * transaction is invisible to the caller and the anti-oracle property is
 * untouched.
 *
 * @returns true when the send may proceed (counter bumped), false when the
 *   cap is spent (nothing written — see the fixed-window note above).
 */
async function registerSend(
  docId: string,
  kind: 'address' | 'bypass' | 'lookup',
  cap: number,
  windowMs: number,
): Promise<boolean> {
  const ref = db.collection(SEND_COUNTERS_COLLECTION).doc(docId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = nextSendCounter(snap.data(), Date.now(), cap, windowMs);
    if (next === null) {
      return false;
    }
    tx.set(ref, { key: docId, kind, count: next.count, windowStart: next.windowStart });
    return true;
  });
}

/** Per-address daily budget (verifyEjmEmail + verifyParentEmail combined). */
export function registerVerificationSend(email: string): Promise<boolean> {
  return registerSend(email, 'address', DAILY_SEND_CAP, DAILY_SEND_WINDOW_MS);
}

/** Per-uid hourly budget for the authed own-email bypass. */
export function registerBypassSend(uid: string): Promise<boolean> {
  return registerSend(uid, 'bypass', BYPASS_SEND_CAP, BYPASS_SEND_WINDOW_MS);
}

/**
 * Per-uid hourly budget for tutor lookups (issue #235, PR #254 review):
 * the lookup surface is deliberately reachable by unverified families, so
 * the throttle -- not a verification gate -- is what keeps one account
 * from driving repeated full scans of the tutor collection. 60/h covers
 * any real typing session (the client debounces to at most ~2 calls/s of
 * sustained typing, and a name needs a handful); the doc id is prefixed
 * so a uid's lookup budget never collides with its bypass-send budget.
 */
export const LOOKUP_CAP = 60;
export const LOOKUP_WINDOW_MS = 60 * 60 * 1000;

export function registerLookup(uid: string): Promise<boolean> {
  return registerSend(`lookup:${uid}`, 'lookup', LOOKUP_CAP, LOOKUP_WINDOW_MS);
}
