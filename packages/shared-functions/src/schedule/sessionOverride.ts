/**
 * Shared restorable-override ledger helpers for schedule claims.
 *
 * Both apps claim a person's slots by AND-ing a block to false in
 * `schedules/{uid}/overrides/{date}` and appending a `sessionBlocks` ledger
 * entry recording exactly what was claimed — so a later cancel can restore
 * precisely those slots and nothing else.
 *
 * study-functions confirms tutoring sessions (`appSource:'study'`,
 * `reason:'study_session'`); functions (sit) confirms babysitting appointments
 * (`appSource:'sit'`, `reason:'appointment'`). Both provenances coexist in ONE
 * override doc for a dual-role uid (same person = tutor + babysitter): each
 * caller passes its own `ownProvenance` and its own entry-`matches` predicate,
 * so restoration only ever removes/reopens ITS OWN claim and the remaining
 * ledger entries (foreign or own) keep their slots blocked. Keeping ONE merge
 * implementation prevents the two apps' claim paths from drifting.
 */

const SLOTS_PER_DAY = 96;

/**
 * A `sessionBlocks` ledger entry. The remaining-coverage check in restoration
 * uses ONLY `startIdx`/`endIdx`, so entries from either app coexist in one
 * array and each app's restore automatically respects the other's ranges. The
 * identity fields are app-specific and optional: study one_time carries
 * `sessionId`, a recurring occurrence adds `instanceId` (=== the date), and sit
 * carries `appointmentId`.
 */
export interface SessionBlockEntry {
  startIdx: number;
  endIdx: number;
  sessionId?: string;
  instanceId?: string;
  appointmentId?: string;
}

/**
 * The provenance an app stamps on the override docs it CREATES, and the gate it
 * matches to decide a doc is solely its own (see buildRestoredOverride). Study:
 * `{ appSource:'study', reason:'study_session' }`. Sit:
 * `{ appSource:'sit', reason:'appointment' }`.
 */
export interface OverrideProvenance {
  appSource: string;
  reason: string;
}

/**
 * Read-modify-write an override doc, claiming `block`'s slots and appending
 * `entry` to its `sessionBlocks` ledger. Preserves every field of a pre-existing
 * (possibly foreign) override; only ever AND-s slots to false — never resurrects
 * a slot it did not itself block. A brand-new doc is stamped with the caller's
 * `ownProvenance`; an existing doc keeps whatever provenance it already had (so
 * the FIRST app to claim a date owns the doc; the second merges into it).
 * Returns the doc to `tx.set` at the date.
 */
export function buildMergedOverride(args: {
  existing: Record<string, unknown> | null;
  date: string;
  weeklySlots: boolean[];
  block: { start: number; end: number };
  entry: SessionBlockEntry;
  ownProvenance: OverrideProvenance;
  now: Date;
}): Record<string, unknown> {
  const { existing, date, weeklySlots, block, entry, ownProvenance, now } = args;

  // Base = existing override's slots, else all-false for an 'unavailable' day,
  // else the weekly grid. We only ever AND our block to false.
  let baseSlots: boolean[];
  if (existing?.slots) {
    baseSlots = [...(existing.slots as boolean[])];
  } else if (existing?.type === 'unavailable') {
    baseSlots = new Array(SLOTS_PER_DAY).fill(false);
  } else {
    baseSlots = new Array(SLOTS_PER_DAY);
    for (let i = 0; i < SLOTS_PER_DAY; i++) baseSlots[i] = weeklySlots[i] ?? false;
  }
  for (let i = block.start; i < block.end; i++) baseSlots[i] = false;

  const priorBlocks = Array.isArray(existing?.sessionBlocks)
    ? (existing!.sessionBlocks as unknown[])
    : [];
  const sessionBlocks = [...priorBlocks, entry];

  const merged: Record<string, unknown> = {
    ...(existing ?? {}),
    date,
    type: (existing?.type as string) ?? 'custom',
    slots: baseSlots,
    sessionBlocks,
    appSource: (existing?.appSource as string) ?? ownProvenance.appSource,
    reason: (existing?.reason as string) ?? ownProvenance.reason,
    updatedAt: now,
  };
  if (!existing) merged.createdAt = now;
  return merged;
}

/**
 * The result of restoring one claim from an override doc — a Firestore action
 * the caller applies inside its cancel transaction:
 *   • 'delete' — the doc was purely ours and held ONLY this claim; remove it so
 *     the day reverts to the bare weekly grid (its natural, override-free state).
 *   • 'set'    — write the returned doc (recomputed-ours, or foreign-conserved).
 *   • 'none'   — no override doc existed; nothing to restore.
 */
export type RestoreResult =
  | { action: 'delete' }
  | { action: 'set'; doc: Record<string, unknown> }
  | { action: 'none' };

/**
 * The inverse of buildMergedOverride: remove the claim(s) selected by `matches`
 * from an override doc and restore exactly the slots those claims held —
 * nothing more.
 *
 * THE CORE INVARIANT (lossless restoration). You cannot naively flip the removed
 * block's slots back to true: a foreign override, or an overlapping REMAINING
 * block, may also cover them. So restoration splits on the doc's PROVENANCE
 * relative to the CALLER's `ownProvenance`:
 *
 *   FOREIGN doc (reason/appSource ≠ ownProvenance — a doc ANOTHER app created,
 *   that we merged our claim INTO, or a legacy doc predating the ledger): we can
 *   NEVER safely flip a slot true. A false slot may be false because the foreign
 *   owner blocked it, not (only) because of our claim, and that is UNKNOWABLE
 *   per-slot. SAFE, CONSERVATIVE rule → drop only our ledger entry and leave
 *   every slot exactly as-is; the slot stays blocked until the foreign owner
 *   clears it. The doc is never deleted (it isn't ours to delete). This is what
 *   makes cross-app closure hold: cancelling OUR claim on a doc the OTHER app
 *   owns never reopens a slot the other app is still holding.
 *
 *   OURS doc (reason AND appSource === ownProvenance — a doc this app created and
 *   solely owns): a CURRENT-SLOTS restore. Start from the doc's EXISTING slots
 *   and reopen ONLY a removed claim's own range — there, a slot goes true iff the
 *   WEEKLY-day grid allows it AND no REMAINING ledger entry still covers it.
 *   Everything OUTSIDE the removed range is left exactly as-is, so a foreign
 *   claim (or a ledgerless block) elsewhere on the day survives. The doc is
 *   DELETEd only when the ledger is empty AND the restored slots equal the weekly
 *   grid exactly (else a residual block remains and deletion would erase it —
 *   keep the doc with an empty ledger instead).
 */
export function buildRestoredOverride(args: {
  existing: Record<string, unknown> | null;
  matches: (entry: SessionBlockEntry) => boolean;
  weeklySlots: boolean[];
  ownProvenance: OverrideProvenance;
  now: Date;
}): RestoreResult {
  const { existing, matches, weeklySlots, ownProvenance, now } = args;

  // No override doc on this date → the claim wrote nothing here to restore.
  if (!existing) return { action: 'none' };

  const priorBlocks: SessionBlockEntry[] = Array.isArray(existing.sessionBlocks)
    ? (existing.sessionBlocks as SessionBlockEntry[])
    : [];
  const removed = priorBlocks.filter(matches);
  const remaining = priorBlocks.filter((b) => !matches(b));

  // ── Provenance gate ──
  const isOurs =
    existing.reason === ownProvenance.reason && existing.appSource === ownProvenance.appSource;

  if (!isOurs) {
    // Foreign: conserve the slots, drop only our ledger entry.
    return {
      action: 'set',
      doc: { ...existing, sessionBlocks: remaining, updatedAt: now },
    };
  }

  // ── Ours: CURRENT-SLOTS restore (preserves foreign / ledgerless blocks) ──
  // Start from the doc's existing slots; reopen ONLY the removed claim's own
  // range, and only where the weekly grid allows AND no REMAINING entry still
  // covers the slot. Slots outside the removed range are never touched.
  const slots = Array.isArray(existing.slots)
    ? [...(existing.slots as boolean[])]
    : new Array(SLOTS_PER_DAY).fill(false);
  const coveredByRemaining = (i: number) =>
    remaining.some((b) => i >= b.startIdx && i < b.endIdx);
  for (const r of removed) {
    for (let i = r.startIdx; i < r.endIdx; i++) {
      if ((weeklySlots[i] ?? false) && !coveredByRemaining(i)) slots[i] = true;
    }
  }

  // Conditional delete: only when nothing else claims the day AND the restored
  // slots are exactly the weekly grid (a truly-ours-only doc). A residual
  // difference means another block remains → keep the doc (empty ledger) so
  // deletion never erases it.
  if (remaining.length === 0) {
    let equalsWeekly = true;
    for (let i = 0; i < SLOTS_PER_DAY; i++) {
      if (slots[i] !== (weeklySlots[i] ?? false)) {
        equalsWeekly = false;
        break;
      }
    }
    if (equalsWeekly) return { action: 'delete' };
    return {
      action: 'set',
      doc: { ...existing, slots, sessionBlocks: [], updatedAt: now },
    };
  }

  return {
    action: 'set',
    doc: { ...existing, slots, sessionBlocks: remaining, updatedAt: now },
  };
}
