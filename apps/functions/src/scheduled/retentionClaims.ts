import type { Firestore } from 'firebase-admin/firestore';
import {
  buildRestoredOverride,
  type OverrideProvenance,
  type SessionBlockEntry,
} from '@ejm/shared-functions/schedule/sessionOverride.js';

/** Weekly-grid day keys, indexed by `Date#getDay()` (cancelAppointment parity). */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** sit's provenance stamp + ownership gate (cancelAppointment's constant). */
export const SIT_PROVENANCE: OverrideProvenance = { appSource: 'sit', reason: 'appointment' };

/** study's provenance stamp + ownership gate (sessionOverride's constant). */
export const STUDY_PROVENANCE: OverrideProvenance = {
  appSource: 'study',
  reason: 'study_session',
};

/** A `YYYY-MM-DD` day key — the shape both `date` fields and override doc ids use. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Releases a schedule claim left behind by an engagement the retention sweep is
 * about to delete (issue #294).
 *
 * WHY THIS EXISTS. Confirming a sit appointment (`respondToRequest`) or a study
 * session (`respondToSession` / `generateInstances`) AND-blocks the provider's
 * `schedules/{uid}/overrides/{date}` slots and appends a `sessionBlocks` ledger
 * entry naming the engagement. Cancelling gives those slots back
 * (`buildRestoredOverride`), and study's hourly `markSessionsCompleted` prunes a
 * recurring OCCURRENCE's entry when it completes — but nothing prunes the entry
 * of a sit appointment that simply ran its course (sit has no `completed`
 * status, so a past sitting stays `confirmed` forever) or of a completed
 * one_time study session. Deleting the parent document without this step is
 * exactly the dangling-reference failure the erased-doer `assignedUserId` bug
 * was: a ledger entry naming a document that no longer exists, on a doc nothing
 * else ever sweeps.
 *
 * The restore itself is the SHARED lossless inverse every cancel path uses, so
 * a foreign (cross-app) claim on the same date is conserved and only this
 * engagement's slots reopen. The dates involved are >180 days past, so reopening
 * them changes no availability anyone can book — the point is to leave the
 * ledger and the documents consistent, and to delete an override doc that now
 * holds nothing.
 */
export function createClaimReleaser(db: Firestore, now: Date) {
  // One weekly-grid read per provider per run (markSessionsCompleted's cache).
  const weeklyCache = new Map<string, Record<string, boolean[]>>();
  const weeklyFor = async (uid: string): Promise<Record<string, boolean[]>> => {
    let weekly = weeklyCache.get(uid);
    if (!weekly) {
      const snap = await db.collection('schedules').doc(uid).get();
      weekly = (snap.data()?.weekly as Record<string, boolean[]>) ?? {};
      weeklyCache.set(uid, weekly);
    }
    return weekly;
  };

  /**
   * Prune the claims `matches` selects from `schedules/{providerUid}/overrides/{date}`.
   * Returns true iff an override doc was actually rewritten or deleted.
   */
  return async function releaseClaim(
    providerUid: string,
    date: string,
    matches: (entry: SessionBlockEntry) => boolean,
    ownProvenance: OverrideProvenance,
  ): Promise<boolean> {
    if (!providerUid || !DATE_RE.test(date)) return false;
    const overrideRef = db
      .collection('schedules')
      .doc(providerUid)
      .collection('overrides')
      .doc(date);

    // Cheap existence probe OUTSIDE the transaction: the overwhelming majority
    // of swept engagements have no override doc left (cancels and study's
    // completion prune already removed it), and a transaction per swept
    // document would dominate the sweep's cost for nothing.
    const probe = await overrideRef.get();
    if (!probe.exists) return false;
    const probeLedger = Array.isArray(probe.data()!.sessionBlocks)
      ? (probe.data()!.sessionBlocks as SessionBlockEntry[])
      : [];
    // Legacy / ledgerless override (pre-H3), or a doc that never carried this
    // claim: leave it exactly as it is — the conservative cancel-path rule.
    if (!probeLedger.some(matches)) return false;

    const weekly = await weeklyFor(providerUid);
    const dayKey = DAY_KEYS[new Date(`${date}T00:00:00`).getDay()];
    const weeklySlots: boolean[] = weekly[dayKey] ?? [];

    let changed = false;
    await db.runTransaction(async (tx) => {
      // Re-read under the lock: the probe above is advisory only.
      const snap = await tx.get(overrideRef);
      if (!snap.exists) return;
      const existing = snap.data()!;
      const ledger = Array.isArray(existing.sessionBlocks)
        ? (existing.sessionBlocks as SessionBlockEntry[])
        : [];
      if (!ledger.some(matches)) return;
      const restore = buildRestoredOverride({
        existing,
        matches,
        weeklySlots,
        ownProvenance,
        now,
      });
      if (restore.action === 'delete') {
        tx.delete(overrideRef);
        changed = true;
      } else if (restore.action === 'set') {
        tx.set(overrideRef, restore.doc);
        changed = true;
      }
    });
    return changed;
  };
}
