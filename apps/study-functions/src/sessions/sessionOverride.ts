import { timeToSlotIndex } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';

/**
 * Shared restorable-override ledger helpers for session confirms.
 *
 * Both the one_time confirm (respondToSession) and the recurring confirm's
 * per-date instance generation (generateInstances) claim a tutor's slots by
 * AND-ing their block to false in `schedules/{uid}/overrides/{date}` and
 * appending a `sessionBlocks` ledger entry recording exactly what was claimed —
 * so a later cancel can restore precisely those slots and nothing else. Keeping
 * ONE merge implementation prevents the two confirm paths from drifting.
 */

const SLOTS_PER_DAY = 96;
const SLOT_MINUTES = 15;

/** Locations whose in-person sessions need travel/prep padding (mirrors study-core). */
export const PADDED_LOCATIONS: ReadonlySet<LocationPref> = new Set<LocationPref>([
  'family_home',
  'tutor_home',
]);

/** The padded slot range [start, end) a session claims, given its location. */
export function paddedBlock(
  startTime: string,
  endTime: string,
  location: LocationPref,
  paddingMinutes: number,
): { start: number; end: number } {
  const startIdx = timeToSlotIndex(startTime);
  const endIdx = timeToSlotIndex(endTime);
  const pad = PADDED_LOCATIONS.has(location)
    ? Math.ceil((paddingMinutes ?? 0) / SLOT_MINUTES)
    : 0;
  return {
    start: Math.max(0, startIdx - pad),
    end: Math.min(SLOTS_PER_DAY, endIdx + pad),
  };
}

/** Half-open ranges [a0,a1) and [b0,b1) overlap. */
export function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

/**
 * A `sessionBlocks` ledger entry. `instanceId` is present for a recurring
 * occurrence's claim (an additive amendment to PR 2's one_time block shape,
 * which simply carries no instanceId) so a per-date override block maps O(1)
 * back to its instance for restoration.
 */
export interface SessionBlockEntry {
  sessionId: string;
  instanceId?: string;
  startIdx: number;
  endIdx: number;
}

/**
 * Read-modify-write an override doc, claiming `block`'s slots and appending
 * `entry` to its `sessionBlocks` ledger. Preserves every field of a pre-existing
 * (possibly foreign) override; only ever AND-s slots to false — never resurrects
 * a slot it did not itself block. Returns the doc to `tx.set` at the date.
 */
export function buildMergedOverride(args: {
  existing: Record<string, unknown> | null;
  date: string;
  weeklySlots: boolean[];
  block: { start: number; end: number };
  entry: SessionBlockEntry;
  now: Date;
}): Record<string, unknown> {
  const { existing, date, weeklySlots, block, entry, now } = args;

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
    appSource: (existing?.appSource as string) ?? 'study',
    reason: (existing?.reason as string) ?? 'study_session',
    updatedAt: now,
  };
  if (!existing) merged.createdAt = now;
  return merged;
}
