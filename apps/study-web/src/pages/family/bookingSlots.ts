import { areSlotsAvailable, slotIndexToTime, DAYS_OF_WEEK } from '@ejm/shared-core';
import type { DayOfWeek } from '@ejm/shared-core';
import { dayOfWeek } from '@ejm/study-core';

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

/** A weekly (day-of-week + start-time) slot offerable for a recurring booking. */
export interface WeeklyCandidate {
  day: DayOfWeek;
  startTime: string;
}

/**
 * Derive the weekly (day, startTime) slots offerable for a recurring booking of
 * `sessionLengthMinutes`, from a window of dated availability grids.
 *
 * CLIENT HEURISTIC — the server is authoritative. A weekly start is offered when
 * it is a valid start chip in at least `minOccurrences` (default 3) of the first
 * `windowOccurrences` (default 4) occurrences of that weekday inside the window.
 * The tutor's accept flow re-expands and re-checks every concrete date, skipping
 * any that conflict — so this heuristic only ever OVER-offers (it can propose a
 * cadence a later individual date declines), never under-offers, which is why
 * the confirm-time "conflicting dates are skipped" disclaimer holds.
 */
export function deriveWeeklySlots(
  dates: { date: string; slots: boolean[] }[],
  sessionLengthMinutes: number,
  minOccurrences = 3,
  windowOccurrences = 4,
): WeeklyCandidate[] {
  // Chips per date grouped by weekday, in date order, capped at the first N
  // occurrences of each weekday (the "next 4 occurrences" window).
  const chipsByDay = new Map<DayOfWeek, string[][]>();
  const sorted = [...dates].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const d of sorted) {
    const day = dayOfWeek(d.date);
    const occ = chipsByDay.get(day) ?? [];
    if (occ.length >= windowOccurrences) continue;
    occ.push(deriveStartChips(d.slots, sessionLengthMinutes));
    chipsByDay.set(day, occ);
  }

  const out: WeeklyCandidate[] = [];
  for (const [day, occurrences] of chipsByDay) {
    // How many of this weekday's occurrences offer each start time.
    const counts = new Map<string, number>();
    for (const chips of occurrences) {
      for (const chip of new Set(chips)) counts.set(chip, (counts.get(chip) ?? 0) + 1);
    }
    for (const [startTime, count] of counts) {
      if (count >= minOccurrences) out.push({ day, startTime });
    }
  }

  // Stable order: weekday (mon..sun), then start time.
  out.sort((a, b) =>
    a.day !== b.day
      ? DAYS_OF_WEEK.indexOf(a.day) - DAYS_OF_WEEK.indexOf(b.day)
      : a.startTime < b.startTime
        ? -1
        : 1,
  );
  return out;
}
