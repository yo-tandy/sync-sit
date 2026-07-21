import { areSlotsAvailable, slotIndexToTime } from '@ejm/shared-core';

/** 15-minute schedule granularity — 96 slots per day (mirrors shared-core). */
const SLOT_MINUTES = 15;
const SLOTS_PER_DAY = 96;

/**
 * Given a tutor's boolean[96] availability grid for ONE day and a chosen session
 * length (minutes), return the "HH:MM" START times at which a session of that
 * length fits entirely within the day's free slots.
 *
 * A start index `i` is offered only when every 15-minute slot from `i` through
 * `i + lengthSlots` is free (`areSlotsAvailable`) AND the session does not run
 * past midnight (`i + lengthSlots <= 96`) — the day-edge guard. Pure and
 * side-effect-free so the calendar can re-derive chips whenever the length
 * changes, and so the derivation is unit-tested without rendering.
 */
export function deriveStartChips(slots: boolean[], sessionLengthMinutes: number): string[] {
  const lengthSlots = Math.ceil(sessionLengthMinutes / SLOT_MINUTES);
  if (lengthSlots <= 0) return [];
  const chips: string[] = [];
  for (let i = 0; i + lengthSlots <= SLOTS_PER_DAY; i++) {
    const start = slotIndexToTime(i);
    const end = slotIndexToTime(i + lengthSlots);
    if (areSlotsAvailable(slots, start, end)) chips.push(start);
  }
  return chips;
}
