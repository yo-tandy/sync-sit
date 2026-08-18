import { SLOTS_PER_DAY } from '@ejm/shared-core';
import { LOCATION_PREFS } from '../constants/locationPrefs.js';
import type { LocationPref } from '../types/subject.js';

/**
 * Per-slot location tags (issue #166) — pure resolution math layered BESIDE
 * computeDayAvailability (whose boolean logic is untouched).
 *
 * Storage shape on `schedules/{uid}`:
 *   weeklyLocations?: { [day]: { [slotIdx: string]: LocationPref[] } }
 * A sparse map per day keyed by slot index ("0".."95"); an absent key means
 * "use the tutor's profile locationPrefs" for that 15-minute cell. Firestore
 * forbids directly nested arrays, so the sparse map (map -> map -> array) is
 * the encoding; an empty array is never stored (it would read as "no location
 * allowed", a state the editor does not offer).
 *
 * sanitizeDayLocations is the SINGLE read seam for every consumer (engine,
 * callables, editor): all junk tolerance lives here, per the #175
 * arrondissements precedent — one bad element in a user-writable doc must
 * never throw in a callable. Junk keys/values are dropped silently.
 */

/** Dense per-cell overrides for one day: null = "profile defaults". */
export type SlotLocationCells = (LocationPref[] | null)[];

/** A contiguous bookable range sharing one effective location set. */
export interface LocationRange {
  startIdx: number; // inclusive slot index
  endIdx: number; // exclusive slot index
  locations: LocationPref[];
}

const VOCABULARY: ReadonlySet<string> = new Set<string>(LOCATION_PREFS);

/** Canonical-order (LOCATION_PREFS), deduped copy of a vocabulary subset. */
function canonicalize(values: Iterable<string>): LocationPref[] {
  const present = new Set(values);
  return LOCATION_PREFS.filter((p) => present.has(p));
}

/**
 * Normalize one day's raw sparse map into a dense 96-cell array.
 * Junk-tolerant: non-object input, non-integer / out-of-range keys, non-array
 * values, non-vocabulary elements, and empty-after-filter arrays all resolve
 * to null cells ("profile defaults") without throwing.
 */
export function sanitizeDayLocations(raw: unknown): SlotLocationCells {
  const cells: SlotLocationCells = new Array(SLOTS_PER_DAY).fill(null);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return cells;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(key)) continue; // integer keys only
    const idx = Number(key);
    if (idx < 0 || idx >= SLOTS_PER_DAY) continue;
    if (!Array.isArray(value)) continue;
    const filtered = canonicalize(
      value.filter((v): v is string => typeof v === 'string' && VOCABULARY.has(v)),
    );
    if (filtered.length === 0) continue; // empty override = defaults
    cells[idx] = filtered;
  }
  return cells;
}

/** One cell's effective set: its override if any, else the profile defaults. */
function cellEffective(
  cells: SlotLocationCells | null | undefined,
  idx: number,
  defaults: LocationPref[],
): LocationPref[] {
  return cells?.[idx] ?? defaults;
}

/**
 * Effective location set for the cell range [startIdx, endIdx): the
 * INTERSECTION of every covered cell's effective set (override ?? defaults).
 * A session spanning cells whose overrides are disjoint has no valid location
 * and yields []. An empty range yields the defaults. Result is in canonical
 * LOCATION_PREFS order.
 */
export function resolveEffectiveLocations(
  cells: SlotLocationCells | null | undefined,
  startIdx: number,
  endIdx: number,
  defaults: LocationPref[],
): LocationPref[] {
  let acc = canonicalize(defaults);
  if (startIdx >= endIdx) return acc;
  for (let i = startIdx; i < endIdx; i++) {
    const eff = cellEffective(cells, i, defaults);
    acc = acc.filter((p) => eff.includes(p));
    if (acc.length === 0) return acc;
  }
  return acc;
}

/**
 * Split a bookable boolean grid into contiguous ranges of constant effective
 * location set: within a run of true cells, a new range starts wherever the
 * effective set changes. Overrides on inactive cells are ignored. An override
 * identical to the defaults set does not split.
 */
export function splitRangesByLocation(
  slots: boolean[],
  cells: SlotLocationCells | null | undefined,
  defaults: LocationPref[],
): LocationRange[] {
  const ranges: LocationRange[] = [];
  let current: LocationRange | null = null;
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    if (!slots[i]) {
      if (current) {
        ranges.push(current);
        current = null;
      }
      continue;
    }
    const eff = canonicalize(cellEffective(cells, i, defaults));
    if (current && current.locations.join(',') === eff.join(',')) {
      current.endIdx = i + 1;
    } else {
      if (current) ranges.push(current);
      current = { startIdx: i, endIdx: i + 1, locations: eff };
    }
  }
  if (current) ranges.push(current);
  return ranges;
}
