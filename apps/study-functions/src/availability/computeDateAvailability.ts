import { timeToSlotIndex, SLOTS_PER_DAY } from '@ejm/shared-core';
import type { DayOfWeek } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import {
  computeDayAvailability,
  dayOfWeek,
  sanitizeDayLocations,
  type ConfirmedBlock,
  type DayOverride,
  type ParisNow,
  type SlotLocationCells,
} from '@ejm/study-core';

/**
 * Single source of the per-date availability composition shared by every study
 * callable that needs a tutor's bookable slot grid: getTutorAvailability (range
 * view), bookSession (book-time best-effort pre-check), and respondToSession
 * (the confirm claim). Keeping ONE composition prevents drift between the
 * picture a family sees, the slot it can request, and the slot the tutor claims.
 *
 * This is a PURE function over PRE-LOADED data — each caller loads Firestore its
 * own way (a range query, single-date gets, or transactional tx.get reads) and
 * then hands the raw pieces here. It derives the holiday-period grid substitution
 * and delegates the base/override/confirmed/notice math to study-core's
 * computeDayAvailability.
 */

export type WeeklyGrid = Partial<Record<DayOfWeek, boolean[]>>;

export interface HolidayPeriod {
  name: string;
  startDate: string;
  endDate: string;
}

export interface DateAvailabilityInputs {
  /** The tutor's weekly slot grid (schedule.weekly). */
  weekly: WeeklyGrid;
  /**
   * Raw per-slot location tags (schedule.weeklyLocations, issue #166) — a
   * sparse per-day map keyed by slot index. Passed through UNSANITIZED;
   * resolveDateLocationCells runs it through study-core's junk-tolerant
   * sanitizer. Absent = legacy doc = all profile-defaults.
   */
  weeklyLocations?: unknown;
  /** 'different' triggers holiday-period grid substitution. */
  holidayMode?: string;
  /** Per-holiday-name weekly grids (schedule.holidaySchedules). */
  holidaySchedules?: Record<string, WeeklyGrid>;
  /** Holiday periods relevant to the date's school year(s) (empty/undefined = none). */
  holidayPeriods?: HolidayPeriod[];
  /** The per-date override doc for this date, if any. */
  override?: DayOverride | null;
  /** Confirmed-session blocks on this date (subtracted, padded for in-person). */
  confirmedBlocks: ConfirmedBlock[];
  /** Transit/prep padding minutes applied to in-person confirmed blocks. */
  paddingMin: number;
}

/** The holiday-period substitution grid for a date, if one applies. */
function holidayGridForDate(
  date: string,
  inputs: DateAvailabilityInputs,
  dow: DayOfWeek,
): boolean[] | undefined {
  if (inputs.holidayMode !== 'different' || !inputs.holidayPeriods) return undefined;
  const period = inputs.holidayPeriods.find(
    (p) => date >= p.startDate && date <= p.endDate,
  );
  return period ? inputs.holidaySchedules?.[period.name]?.[dow] : undefined;
}

/** Compute a single date's bookable slot grid from pre-loaded inputs. */
export function computeDateAvailability(
  date: string,
  inputs: DateAvailabilityInputs,
  nowParis: ParisNow,
  noticeHours: number,
): boolean[] {
  const dow = dayOfWeek(date);
  const holidayGrid = holidayGridForDate(date, inputs, dow);

  return computeDayAvailability({
    date,
    weeklySlots: inputs.weekly[dow] ?? [],
    override: inputs.override,
    holidayGrid,
    confirmedBlocks: inputs.confirmedBlocks,
    paddingMin: inputs.paddingMin,
    nowParis,
    noticeHours,
  });
}

/**
 * Per-slot location tags applicable to a date (issue #166). The tags are
 * indexed against the WEEKLY grid, so they apply only when that grid is the
 * date's base — i.e. no holiday-schedule substitution and no custom-override
 * slots (base precedence: holidayGrid ?? override.slots ?? weekly). On any
 * other date (owner decision: overrides/holiday tags are a follow-up) every
 * cell resolves to "profile defaults" — all-null cells. An 'unavailable'
 * override also returns all-null: nothing is bookable, so tags are moot.
 */
export function resolveDateLocationCells(
  date: string,
  inputs: DateAvailabilityInputs,
): SlotLocationCells {
  const dow = dayOfWeek(date);
  const weeklyBaseApplies =
    inputs.override?.type !== 'unavailable' &&
    !(inputs.override?.type === 'custom' && inputs.override.slots) &&
    holidayGridForDate(date, inputs, dow) === undefined;
  if (!weeklyBaseApplies) {
    return new Array(SLOTS_PER_DAY).fill(null) as SlotLocationCells;
  }
  const raw =
    typeof inputs.weeklyLocations === 'object' && inputs.weeklyLocations !== null
      ? (inputs.weeklyLocations as Record<string, unknown>)[dow]
      : undefined;
  return sanitizeDayLocations(raw);
}

/** Project a study-session doc's fields onto a confirmed-session slot block. */
export function sessionToConfirmedBlock(s: {
  startTime: string;
  endTime: string;
  location: LocationPref;
}): ConfirmedBlock {
  return {
    startIdx: timeToSlotIndex(s.startTime),
    endIdx: timeToSlotIndex(s.endTime),
    location: s.location,
  };
}
