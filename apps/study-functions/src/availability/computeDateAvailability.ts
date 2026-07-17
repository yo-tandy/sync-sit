import { timeToSlotIndex } from '@ejm/shared-core';
import type { DayOfWeek } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import {
  computeDayAvailability,
  dayOfWeek,
  type ConfirmedBlock,
  type DayOverride,
  type ParisNow,
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

/** Compute a single date's bookable slot grid from pre-loaded inputs. */
export function computeDateAvailability(
  date: string,
  inputs: DateAvailabilityInputs,
  nowParis: ParisNow,
  noticeHours: number,
): boolean[] {
  const dow = dayOfWeek(date);

  let holidayGrid: boolean[] | undefined;
  if (inputs.holidayMode === 'different' && inputs.holidayPeriods) {
    const period = inputs.holidayPeriods.find(
      (p) => date >= p.startDate && date <= p.endDate,
    );
    if (period) holidayGrid = inputs.holidaySchedules?.[period.name]?.[dow];
  }

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
