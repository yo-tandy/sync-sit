import { SCHEDULE_SLOT_MINUTES, SLOTS_PER_DAY } from '@ejm/shared-core';
import type { DayOfWeek, RecurringSlot } from '@ejm/shared-core';
import type { LocationPref } from '../types/subject.js';

/**
 * Pure availability + recurring-date math shared by the study session-booking
 * backend and any client-side previews. Nothing here touches Firestore, the
 * clock, or the machine timezone.
 *
 * DST safety is the whole point of the date helpers below: every calendar
 * computation is done with Y-M-D integer arithmetic, NEVER by stepping an
 * epoch-millisecond value. Adding "one day" as 86_400_000 ms drifts by an hour
 * across a Europe/Paris DST transition and can flip the calendar date; adding
 * one day to the D field cannot. Wall-clock time-of-day is never converted to
 * an instant here — that conversion lives in the parisTime helpers on the
 * backend, and this module only ever compares calendar-relative positions.
 */

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

interface Ymd {
  year: number;
  month: number; // 1-12
  day: number;
}

function parseDate(date: string): Ymd {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

/**
 * Add one calendar day to a "YYYY-MM-DD" string by incrementing the day field
 * and rolling month/year over — pure calendar arithmetic, DST-immune.
 */
function incrementDate(date: string): string {
  let { year, month, day } = parseDate(date);
  const daysThisMonth =
    month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  day += 1;
  if (day > daysThisMonth) {
    day = 1;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Day of week for a "YYYY-MM-DD" date via Sakamoto's algorithm — pure integer
 * math, no Date object, no timezone. Returns our 'mon'..'sun' key.
 */
function dayOfWeek(date: string): DayOfWeek {
  const { year, month, day } = parseDate(date);
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = month < 3 ? year - 1 : year;
  const sundayZero = (y + Math.floor(y / 4) - Math.floor(y / 100) +
    Math.floor(y / 400) + t[month - 1] + day) % 7; // 0 = Sunday
  const keys: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return keys[sundayZero];
}

/**
 * Monotonic day count for a "YYYY-MM-DD" date (Howard Hinnant's days-from-civil
 * algorithm). Used only for ordering dates relative to one another — pure
 * integer arithmetic, never epoch-ms.
 */
function ordinalDay(date: string): number {
  const { year, month, day } = parseDate(date);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** A confirmed-session block projected onto the day's slot grid. */
export interface ConfirmedBlock {
  startIdx: number; // inclusive slot index
  endIdx: number; // exclusive slot index
  location: LocationPref;
}

/** A per-date override loaded from `schedules/{uid}/overrides/{date}`. */
export interface DayOverride {
  type: 'unavailable' | 'custom';
  slots?: boolean[];
}

/** Current Paris wall-clock position, expressed calendar-relative. */
export interface ParisNow {
  date: string; // "YYYY-MM-DD" (Paris date)
  minutesSinceMidnight: number; // 0-1439 (Paris wall time)
}

export interface ComputeDayAvailabilityArgs {
  date: string;
  weeklySlots: boolean[]; // the tutor's weekly grid for this date's DayOfWeek
  override?: DayOverride | null;
  holidayGrid?: boolean[] | null; // holiday-period substitution grid, if any
  confirmedBlocks: ConfirmedBlock[];
  paddingMin: number;
  nowParis: ParisNow;
  noticeHours: number;
}

/** Locations where an in-person session needs travel/prep padding. */
const PADDED_LOCATIONS: ReadonlySet<LocationPref> = new Set<LocationPref>([
  'family_home',
  'tutor_home',
]);

/**
 * Compute a single date's bookable slot grid:
 *   base = holidayGrid ?? custom-override ?? weekly
 *   'unavailable' override zeroes the whole day
 *   minus each confirmed block (± padding for in-person locations)
 *   minus every slot that starts before now + noticeHours.
 * Returns a fresh boolean[96]; inputs are never mutated.
 */
export function computeDayAvailability({
  date,
  weeklySlots,
  override,
  holidayGrid,
  confirmedBlocks,
  paddingMin,
  nowParis,
  noticeHours,
}: ComputeDayAvailabilityArgs): boolean[] {
  // An explicit "unavailable" override wins over everything else.
  if (override?.type === 'unavailable') {
    return new Array(SLOTS_PER_DAY).fill(false);
  }

  const base =
    holidayGrid ??
    (override?.type === 'custom' ? override.slots : undefined) ??
    weeklySlots;
  // Copy into a full-length grid so we never mutate the caller's array and
  // never read past 96 slots.
  const grid: boolean[] = new Array(SLOTS_PER_DAY);
  for (let i = 0; i < SLOTS_PER_DAY; i++) grid[i] = base?.[i] ?? false;

  // Subtract confirmed sessions, padding in-person ones on both sides.
  const paddingSlots = Math.ceil(paddingMin / SCHEDULE_SLOT_MINUTES);
  for (const block of confirmedBlocks) {
    const pad = PADDED_LOCATIONS.has(block.location) ? paddingSlots : 0;
    const start = Math.max(0, block.startIdx - pad);
    const end = Math.min(SLOTS_PER_DAY, block.endIdx + pad);
    for (let i = start; i < end; i++) grid[i] = false;
  }

  // Zero every slot whose wall-clock start is before now + noticeHours. Compare
  // calendar-minute positions so this holds across dates without epoch math.
  const cutoffMinutes =
    ordinalDay(nowParis.date) * 1440 +
    nowParis.minutesSinceMidnight +
    noticeHours * 60;
  const dayStartMinutes = ordinalDay(date) * 1440;
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    if (dayStartMinutes + i * SCHEDULE_SLOT_MINUTES < cutoffMinutes) {
      grid[i] = false;
    }
  }

  return grid;
}

/**
 * Expand a weekly recurring slot into concrete "YYYY-MM-DD" dates:
 *   - first occurrence is slot.day on/after fromDate,
 *   - weekly cadence for up to `weeks` occurrences,
 *   - occurrences after endDate (inclusive) are truncated,
 *   - occurrences inside a holiday period are dropped when schoolWeeksOnly
 *     (period boundaries inclusive on both ends).
 * All stepping is pure Y-M-D arithmetic — cadence is exact across DST.
 */
export function expandRecurringDates(
  slot: RecurringSlot,
  fromDate: string,
  weeks: number,
  endDate: string | undefined,
  schoolWeeksOnly: boolean,
  holidayPeriods: { startDate: string; endDate: string }[],
): string[] {
  // Walk forward day-by-day (at most 6 steps) to the first matching weekday.
  let cursor = fromDate;
  while (dayOfWeek(cursor) !== slot.day) {
    cursor = incrementDate(cursor);
  }

  const inHoliday = (date: string): boolean =>
    holidayPeriods.some((p) => date >= p.startDate && date <= p.endDate);

  const dates: string[] = [];
  for (let week = 0; week < weeks; week++) {
    if (endDate !== undefined && cursor > endDate) break; // dates only increase
    if (!(schoolWeeksOnly && inHoliday(cursor))) {
      dates.push(cursor);
    }
    // Advance exactly seven calendar days to next week's occurrence.
    for (let step = 0; step < 7; step++) cursor = incrementDate(cursor);
  }
  return dates;
}

/** School-year start year for a date: Sep 1 flips into the next year's key. */
function schoolYearStartYear(date: string): number {
  const { year, month } = parseDate(date);
  return month >= 9 ? year : year - 1;
}

/**
 * The "YYYY-YYYY" school-year doc keys a [startDate, endDate] range touches.
 * A late-August-into-September range spans two. Assumes startDate <= endDate.
 */
export function getSchoolYearsInRange(
  startDate: string,
  endDate: string,
): string[] {
  const first = schoolYearStartYear(startDate);
  const last = schoolYearStartYear(endDate);
  const years: string[] = [];
  for (let y = first; y <= last; y++) years.push(`${y}-${y + 1}`);
  return years;
}
