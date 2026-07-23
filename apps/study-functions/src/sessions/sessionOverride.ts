import { timeToSlotIndex } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import {
  buildMergedOverride as sharedBuildMergedOverride,
  buildRestoredOverride as sharedBuildRestoredOverride,
  type RestoreResult,
} from '@ejm/shared-functions/schedule/sessionOverride.js';

/**
 * Study-side restorable-override ledger helpers for session confirms.
 *
 * The merge/restore engine now lives in @ejm/shared-functions so sit
 * appointments can carry the SAME `sessionBlocks` ledger and coexist with study
 * claims in one override doc (a dual-role tutor+babysitter uid). This file keeps
 * the study-specific padding math (location-based travel/prep) and re-exports
 * the generalized helpers pinned to study's provenance, so the 5 study call
 * sites (respondToSession, generateInstances, cancelSession, cancelSessionInstance,
 * markSessionsCompleted) stay byte-for-byte unchanged.
 */

const SLOTS_PER_DAY = 96;
const SLOT_MINUTES = 15;

/** Study's provenance stamp + ownership gate. */
const STUDY_PROVENANCE = { appSource: 'study', reason: 'study_session' } as const;

export type { RestoreResult };

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
 * A study `sessionBlocks` ledger entry. `instanceId` is present for a recurring
 * occurrence's claim (===the date); a one_time claim carries none.
 */
export interface SessionBlockEntry {
  sessionId: string;
  instanceId?: string;
  startIdx: number;
  endIdx: number;
}

/**
 * Read-modify-write an override doc, claiming `block`'s slots and appending
 * `entry` to its `sessionBlocks` ledger (study provenance). See the shared
 * helper for the AND-only / foreign-preservation invariants.
 */
export function buildMergedOverride(args: {
  existing: Record<string, unknown> | null;
  date: string;
  weeklySlots: boolean[];
  block: { start: number; end: number };
  entry: SessionBlockEntry;
  now: Date;
}): Record<string, unknown> {
  return sharedBuildMergedOverride({ ...args, ownProvenance: STUDY_PROVENANCE });
}

/**
 * The inverse of buildMergedOverride for study: remove ONE session's claim
 * (matched by sessionId AND instanceId — a one_time claim has both undefined; a
 * recurring occurrence is keyed by its instanceId) and restore exactly the slots
 * it held. See the shared helper for the lossless-restoration invariant.
 */
export function buildRestoredOverride(args: {
  existing: Record<string, unknown> | null;
  sessionId: string;
  instanceId?: string;
  weeklySlots: boolean[];
  now: Date;
}): RestoreResult {
  const { existing, sessionId, instanceId, weeklySlots, now } = args;
  return sharedBuildRestoredOverride({
    existing,
    matches: (b) =>
      b.sessionId === sessionId && (b.instanceId ?? undefined) === (instanceId ?? undefined),
    weeklySlots,
    ownProvenance: STUDY_PROVENANCE,
    now,
  });
}
