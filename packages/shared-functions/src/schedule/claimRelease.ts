import type { Firestore } from 'firebase-admin/firestore';
import {
  buildRestoredOverride,
  type OverrideProvenance,
  type SessionBlockEntry,
} from './sessionOverride.js';

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
 * Releases a schedule claim left behind by an engagement that is being deleted
 * or force-cancelled by a server-side path with no user in the loop.
 *
 * WHY THIS EXISTS. Confirming a sit appointment (`respondToRequest`) or a study
 * session (`respondToSession` / `generateInstances`) AND-blocks the provider's
 * `schedules/{uid}/overrides/{date}` slots and appends a `sessionBlocks` ledger
 * entry naming the engagement. The member-facing cancel paths give those slots
 * back (`buildRestoredOverride`), and study's hourly `markSessionsCompleted`
 * prunes a recurring OCCURRENCE's entry when it completes — but the ADMIN and
 * SCHEDULED paths did not, and a claim nobody releases is a slot that stays
 * unavailable forever with nothing pointing at it.
 *
 * Three callers, all of them a provider-side claim the counterparty's action
 * (or a sweep) must release:
 *   • the retention sweeps (issue #294 / PR #396) — the engagement document is
 *     about to be deleted, so an unreleased entry would name a document that no
 *     longer exists;
 *   • `deleteUser` (issue #408 item 1) — a family erasure cancels the SURVIVING
 *     provider's engagements, so the claim must come back to them;
 *   • `admin/deleteAppointment` (issue #408 item 4) — same shape, one document.
 *
 * The restore itself is the SHARED lossless inverse every cancel path uses, so
 * a foreign (cross-app) claim on the same date is conserved and only this
 * engagement's slots reopen. When the override doc held nothing else, it is
 * deleted and the day reverts to the bare weekly grid.
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
