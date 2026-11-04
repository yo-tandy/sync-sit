import { SCHEDULE_SLOT_MINUTES, SLOTS_PER_DAY } from '../constants/config.js';

/**
 * Convert "HH:MM" time string to slot index (0-95).
 */
export function timeToSlotIndex(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return Math.floor((hours * 60 + minutes) / SCHEDULE_SLOT_MINUTES);
}

/**
 * Convert slot index (0-95) to "HH:MM" time string.
 */
export function slotIndexToTime(index: number): string {
  const totalMinutes = index * SCHEDULE_SLOT_MINUTES;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * The slot indices a `[startIdx, endIdx)` range covers on ONE day's slot
 * array, following the wrap past midnight (issue #510).
 *
 * Storage convention — set by the writer, `DayEditor`: a day's slots `0..7`
 * are the small hours OF THAT SAME DAY KEY, and an overnight range such as
 * 22:00 → 02:00 sets `88..95` then `0..7` in the one array. Every reader must
 * walk the same two runs; the naive `for (i = start; i < end)` loop runs zero
 * times for a wrapped range and silently reads as "all clear" / "nothing to
 * do".
 *
 * `endIdx <= startIdx` wraps (`publishSearch`'s rule: an end that is not
 * after the start crosses midnight), so `start === end` covers the whole day.
 * Indices are clamped to `[0, SLOTS_PER_DAY)`; `endIdx === SLOTS_PER_DAY`
 * (a "24:00" end) is a plain range to end of day, not a wrap.
 */
export function rangeSlotIndices(startIdx: number, endIdx: number): number[] {
  const start = Math.max(0, Math.min(startIdx, SLOTS_PER_DAY));
  const end = Math.max(0, Math.min(endIdx, SLOTS_PER_DAY));
  const idxs: number[] = [];
  if (start < end) {
    for (let i = start; i < end; i++) idxs.push(i);
  } else {
    for (let i = start; i < SLOTS_PER_DAY; i++) idxs.push(i);
    for (let i = 0; i < end; i++) idxs.push(i);
  }
  return idxs;
}

/** `rangeSlotIndices` for "HH:MM" bounds. */
export function timeRangeSlotIndices(startTime: string, endTime: string): number[] {
  return rangeSlotIndices(timeToSlotIndex(startTime), timeToSlotIndex(endTime));
}

/**
 * Whether slot `i` lies inside `[startIdx, endIdx)`, wrap-aware like
 * `rangeSlotIndices` (a ledger entry `{ startIdx: 88, endIdx: 8 }` covers
 * slot 2). Same clamping and `<=`-wraps rule.
 */
export function slotInRange(i: number, startIdx: number, endIdx: number): boolean {
  const start = Math.max(0, Math.min(startIdx, SLOTS_PER_DAY));
  const end = Math.max(0, Math.min(endIdx, SLOTS_PER_DAY));
  if (i < 0 || i >= SLOTS_PER_DAY) return false;
  if (start < end) return i >= start && i < end;
  return i >= start || i < end;
}

/**
 * Check if all slots between startTime and endTime are available.
 * Wrap-aware: 22:00 → 02:00 checks `88..95` and `0..7` (issue #510).
 */
export function areSlotsAvailable(
  slots: boolean[],
  startTime: string,
  endTime: string
): boolean {
  return timeRangeSlotIndices(startTime, endTime).every((i) => !!slots[i]);
}

/**
 * Create an empty schedule (all unavailable).
 */
export function createEmptySlots(): boolean[] {
  return new Array(SLOTS_PER_DAY).fill(false);
}

/**
 * Create a fully available schedule.
 */
export function createFullSlots(): boolean[] {
  return new Array(SLOTS_PER_DAY).fill(true);
}

/**
 * Set a range of slots to a value. Wrap-aware: 22:00 → 02:00 writes `88..95`
 * and `0..7` of the same array (issue #510; the `DayEditor` convention).
 */
export function setSlotRange(
  slots: boolean[],
  startTime: string,
  endTime: string,
  value: boolean
): boolean[] {
  const result = [...slots];
  for (const i of timeRangeSlotIndices(startTime, endTime)) result[i] = value;
  return result;
}
