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
 * The slot indices a `[startIdx, endIdx)` range covers, WRAPPING PAST MIDNIGHT.
 *
 * Every consumer of a time range used to walk it as
 * `for (let i = startIdx; i < endIdx; i++)`. For an overnight range that loop
 * has ZERO iterations (22:00 → 02:00 is `i = 88; i < 8`), and depending on the
 * call site the absence read as "all clear" (search matched every babysitter)
 * or "nothing to do" (an accepted booking claimed no slots) — issue #510.
 *
 * THE CONVENTION IS THE EDITOR'S, not a new one. `DayEditor`'s
 * `addWrappingRange` has always written an overnight availability range as
 * `startIdx..95` plus `0..endIdx` in ONE day's array, so a day's slots `0..7`
 * are the small hours of that same day key. A reader that instead looked at
 * day D+1 would not find what the editor wrote. This helper is that editor
 * logic, lifted so every reader agrees with the writer.
 *
 * `endIdx <= startIdx` wraps — one rule, no special case. That makes
 * `18:00 → 00:00` mean "until midnight" (72..95, the case that matters) and
 * the degenerate `18:00 → 18:00` mean the same rather than a silent nothing.
 * Neither over-claims.
 */
export function slotRangeIndices(startIdx: number, endIdx: number): number[] {
  const idxs: number[] = [];
  if (startIdx < endIdx) {
    for (let i = startIdx; i < endIdx && i < SLOTS_PER_DAY; i++) idxs.push(i);
    return idxs;
  }
  for (let i = startIdx; i < SLOTS_PER_DAY; i++) idxs.push(i);
  for (let i = 0; i < endIdx && i < SLOTS_PER_DAY; i++) idxs.push(i);
  return idxs;
}

/**
 * Whether slot `i` falls in `[startIdx, endIdx)`, with the same wrap rule as
 * `slotRangeIndices`. The membership form, for predicates that cannot walk the
 * range (e.g. "is this slot still covered by a remaining claim?").
 */
export function slotRangeCovers(i: number, startIdx: number, endIdx: number): boolean {
  if (startIdx < endIdx) return i >= startIdx && i < endIdx;
  return i >= startIdx || i < endIdx;
}

/**
 * The slot indices an "HH:MM"–"HH:MM" range covers, wrapping past midnight.
 */
export function timeRangeSlotIndices(startTime: string, endTime: string): number[] {
  return slotRangeIndices(timeToSlotIndex(startTime), timeToSlotIndex(endTime));
}

/**
 * Check if all slots between startTime and endTime are available.
 * Overnight ranges wrap — see `slotRangeIndices`.
 */
export function areSlotsAvailable(
  slots: boolean[],
  startTime: string,
  endTime: string
): boolean {
  return timeRangeSlotIndices(startTime, endTime).every((i) => slots[i]);
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
 * Set a range of slots to a value.
 */
export function setSlotRange(
  slots: boolean[],
  startTime: string,
  endTime: string,
  value: boolean
): boolean[] {
  const result = [...slots];
  for (const i of timeRangeSlotIndices(startTime, endTime)) {
    result[i] = value;
  }
  return result;
}
