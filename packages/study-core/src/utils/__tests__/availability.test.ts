import { describe, it, expect } from 'vitest';
import {
  computeDayAvailability,
  expandRecurringDates,
  getSchoolYearsInRange,
} from '../availability.js';
import type { RecurringSlot } from '@ejm/shared-core';

// Grid helpers — 96 fifteen-minute slots per day.
const allTrue = () => new Array(96).fill(true) as boolean[];
const allFalse = () => new Array(96).fill(false) as boolean[];

// A now-instant far in the past so the notice window never interferes unless a
// test opts in explicitly.
const PAST = { date: '2000-01-01', minutesSinceMidnight: 0 };

describe('computeDayAvailability', () => {
  it('passes the weekly grid through untouched when nothing else applies', () => {
    const weekly = allFalse();
    weekly[32] = weekly[33] = weekly[34] = true; // 08:00–08:45
    const out = computeDayAvailability({
      date: '2026-07-15',
      weeklySlots: weekly,
      confirmedBlocks: [],
      paddingMin: 15,
      nowParis: PAST,
      noticeHours: 24,
    });
    expect(out).toEqual(weekly);
    expect(out).not.toBe(weekly); // returns a copy, never mutates input
  });

  it('zeroes the whole day for an "unavailable" override', () => {
    const out = computeDayAvailability({
      date: '2026-07-15',
      weeklySlots: allTrue(),
      override: { type: 'unavailable' },
      confirmedBlocks: [],
      paddingMin: 15,
      nowParis: PAST,
      noticeHours: 24,
    });
    expect(out).toEqual(allFalse());
  });

  it('uses a "custom" override grid instead of the weekly grid', () => {
    const custom = allFalse();
    custom[40] = custom[41] = true; // 10:00–10:30
    const out = computeDayAvailability({
      date: '2026-07-15',
      weeklySlots: allTrue(),
      override: { type: 'custom', slots: custom },
      confirmedBlocks: [],
      paddingMin: 15,
      nowParis: PAST,
      noticeHours: 24,
    });
    expect(out).toEqual(custom);
  });

  it('substitutes the holiday grid, taking precedence over weekly and custom', () => {
    const holiday = allFalse();
    holiday[60] = true; // 15:00
    const custom = allTrue();
    const out = computeDayAvailability({
      date: '2026-07-15',
      weeklySlots: allTrue(),
      override: { type: 'custom', slots: custom },
      holidayGrid: holiday,
      confirmedBlocks: [],
      paddingMin: 15,
      nowParis: PAST,
      noticeHours: 24,
    });
    expect(out).toEqual(holiday);
  });

  it('subtracts a confirmed block WITH padding for family_home', () => {
    const out = computeDayAvailability({
      date: '2026-07-15',
      weeklySlots: allTrue(),
      confirmedBlocks: [{ startIdx: 40, endIdx: 44, location: 'family_home' }],
      paddingMin: 30, // 2 slots of padding on each side
      nowParis: PAST,
      noticeHours: 24,
    });
    expect(out[37]).toBe(true); // just before padded region
    for (let i = 38; i < 46; i++) expect(out[i]).toBe(false); // 40..44 ± 2
    expect(out[46]).toBe(true); // just after
  });

  it('subtracts a confirmed block WITHOUT padding for online/library', () => {
    for (const location of ['online', 'library'] as const) {
      const out = computeDayAvailability({
        date: '2026-07-15',
        weeklySlots: allTrue(),
        confirmedBlocks: [{ startIdx: 40, endIdx: 44, location }],
        paddingMin: 30,
        nowParis: PAST,
        noticeHours: 24,
      });
      expect(out[39]).toBe(true);
      for (let i = 40; i < 44; i++) expect(out[i]).toBe(false);
      expect(out[44]).toBe(true);
    }
  });

  it('clamps padded blocks at the day edges (no negative or overflow indices)', () => {
    const early = computeDayAvailability({
      date: '2026-07-15',
      weeklySlots: allTrue(),
      confirmedBlocks: [{ startIdx: 1, endIdx: 3, location: 'tutor_home' }],
      paddingMin: 60, // 4 slots — would run off the start
      nowParis: PAST,
      noticeHours: 24,
    });
    expect(early).toHaveLength(96);
    for (let i = 0; i < 7; i++) expect(early[i]).toBe(false);
    expect(early[7]).toBe(true);

    const late = computeDayAvailability({
      date: '2026-07-15',
      weeklySlots: allTrue(),
      confirmedBlocks: [{ startIdx: 94, endIdx: 96, location: 'tutor_home' }],
      paddingMin: 60, // would run off the end
      nowParis: PAST,
      noticeHours: 24,
    });
    expect(late).toHaveLength(96);
    expect(late[89]).toBe(true);
    for (let i = 90; i < 96; i++) expect(late[i]).toBe(false);
  });

  it('zeroes slots inside the notice window (today) but leaves days past it untouched', () => {
    const now = { date: '2026-07-16', minutesSinceMidnight: 10 * 60 }; // 10:00 Paris
    const args = {
      weeklySlots: allTrue(),
      confirmedBlocks: [],
      paddingMin: 15,
      nowParis: now,
      noticeHours: 24,
    };
    // Today is entirely within now+24h → fully zeroed.
    const today = computeDayAvailability({ ...args, date: '2026-07-16' });
    expect(today).toEqual(allFalse());
    // Tomorrow: slots before 10:00 are inside the window, 10:00 onward free.
    const tomorrow = computeDayAvailability({ ...args, date: '2026-07-17' });
    expect(tomorrow[39]).toBe(false); // 09:45 < cutoff
    expect(tomorrow[40]).toBe(true); // 10:00 == cutoff, not before it
    // Day after: fully outside the window.
    const dayAfter = computeDayAvailability({ ...args, date: '2026-07-18' });
    expect(dayAfter).toEqual(allTrue());
  });
});

describe('expandRecurringDates', () => {
  const sunday: RecurringSlot = { day: 'sun', startTime: '10:00', endTime: '11:00' };

  it('expands a weekly cadence from a matching fromDate', () => {
    // 2026-07-05 is a Sunday.
    expect(
      expandRecurringDates(sunday, '2026-07-05', 4, undefined, false, []),
    ).toEqual(['2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26']);
  });

  it('starts at the first matching weekday on/after fromDate', () => {
    // 2026-07-06 is a Monday → first Sunday is 2026-07-12.
    expect(
      expandRecurringDates(sunday, '2026-07-06', 2, undefined, false, []),
    ).toEqual(['2026-07-12', '2026-07-19']);
  });

  it('truncates occurrences past endDate', () => {
    expect(
      expandRecurringDates(sunday, '2026-07-05', 10, '2026-07-19', false, []),
    ).toEqual(['2026-07-05', '2026-07-12', '2026-07-19']);
  });

  it('drops holiday-period dates only when schoolWeeksOnly is set', () => {
    const holidays = [{ startDate: '2026-07-12', endDate: '2026-07-19' }];
    expect(
      expandRecurringDates(sunday, '2026-07-05', 4, undefined, true, holidays),
    ).toEqual(['2026-07-05', '2026-07-26']);
    // Same holidays, but schoolWeeksOnly=false keeps every week.
    expect(
      expandRecurringDates(sunday, '2026-07-05', 4, undefined, false, holidays),
    ).toEqual(['2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26']);
  });

  it('treats holiday-period boundaries as inclusive on both ends', () => {
    // Period end 2026-07-12 must drop 2026-07-12 (inclusive upper bound).
    expect(
      expandRecurringDates(sunday, '2026-07-05', 4, undefined, true, [
        { startDate: '2026-07-01', endDate: '2026-07-12' },
      ]),
    ).toEqual(['2026-07-19', '2026-07-26']);
    // Single-day period equal to a candidate drops exactly that date.
    expect(
      expandRecurringDates(sunday, '2026-07-05', 4, undefined, true, [
        { startDate: '2026-07-19', endDate: '2026-07-19' },
      ]),
    ).toEqual(['2026-07-05', '2026-07-12', '2026-07-26']);
  });

  it('keeps a 7-day cadence across the autumn DST fall-back (2026-10-25)', () => {
    // 2026-10-18 is a Sunday; the clocks fall back on 2026-10-25.
    expect(
      expandRecurringDates(sunday, '2026-10-18', 4, undefined, false, []),
    ).toEqual(['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08']);
  });

  it('keeps a 7-day cadence across the spring DST forward (2027-03-28)', () => {
    // 2027-03-21 is a Sunday; the clocks spring forward on 2027-03-28.
    expect(
      expandRecurringDates(sunday, '2027-03-21', 3, undefined, false, []),
    ).toEqual(['2027-03-21', '2027-03-28', '2027-04-04']);
  });

  it('rolls over a leap day correctly (pure calendar stepping)', () => {
    const tuesday: RecurringSlot = { day: 'tue', startTime: '10:00', endTime: '11:00' };
    // 2028-02-29 is a Tuesday (2028 is a leap year).
    expect(
      expandRecurringDates(tuesday, '2028-02-22', 3, undefined, false, []),
    ).toEqual(['2028-02-22', '2028-02-29', '2028-03-07']);
  });
});

describe('getSchoolYearsInRange', () => {
  it('returns a single school year for an autumn range', () => {
    expect(getSchoolYearsInRange('2026-10-01', '2026-12-15')).toEqual([
      '2026-2027',
    ]);
  });

  it('maps a spring range back to the school year that started the prior autumn', () => {
    expect(getSchoolYearsInRange('2027-01-10', '2027-05-20')).toEqual([
      '2026-2027',
    ]);
  });

  it('spans two school years for a late-August-into-September range', () => {
    expect(getSchoolYearsInRange('2026-08-25', '2026-09-05')).toEqual([
      '2025-2026',
      '2026-2027',
    ]);
  });

  it('treats September 1 as the school-year boundary', () => {
    expect(getSchoolYearsInRange('2026-09-01', '2026-09-01')).toEqual([
      '2026-2027',
    ]);
    expect(getSchoolYearsInRange('2026-08-31', '2026-08-31')).toEqual([
      '2025-2026',
    ]);
  });

  it('spans two school years for a full-calendar-year range', () => {
    expect(getSchoolYearsInRange('2026-01-01', '2026-12-31')).toEqual([
      '2025-2026',
      '2026-2027',
    ]);
  });
});
