import { describe, it, expect } from 'vitest';
import { deriveStartChips, deriveWeeklySlots } from '../bookingSlots';

/** A boolean[96] grid, all false except the given [start, end) slot indices. */
function gridWith(...ranges: [number, number][]): boolean[] {
  const slots = new Array(96).fill(false);
  for (const [start, end] of ranges) {
    for (let i = start; i < end; i++) slots[i] = true;
  }
  return slots;
}

describe('deriveStartChips', () => {
  it('returns exactly the start times where a 60-min session fits (one free block)', () => {
    // 14:00–15:00 free = indices 56..59 (four 15-min slots). A 60-min session
    // (4 slots) fits ONLY starting at 14:00.
    const slots = gridWith([56, 60]);
    expect(deriveStartChips(slots, 60)).toEqual(['14:00']);
  });

  it('offers every fitting start within a longer free block', () => {
    // 09:00–10:30 free = indices 36..41 (six slots). A 30-min session (2 slots)
    // can start at each of the first five slots: 09:00,09:15,09:30,09:45,10:00.
    const slots = gridWith([36, 42]);
    expect(deriveStartChips(slots, 30)).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
    ]);
  });

  it('does not offer a start that would cross a gap in the grid', () => {
    // 08:00–08:30 free (32..33) then a gap, 09:00–09:30 free (36..37). No single
    // 45-min (3-slot) window is contiguous, so no chips.
    const slots = gridWith([32, 34], [36, 38]);
    expect(deriveStartChips(slots, 45)).toEqual([]);
  });

  it('never offers a start whose session would run past midnight (day edge)', () => {
    // Only 23:00–23:59 free = indices 92..95 (four slots). A 60-min session
    // fits starting at 23:00 (92..95). But a 75-min session (5 slots) would need
    // index 96 → past midnight → no chip.
    const slots = gridWith([92, 96]);
    expect(deriveStartChips(slots, 60)).toEqual(['23:00']);
    expect(deriveStartChips(slots, 75)).toEqual([]);
  });

  it('returns no chips for an all-false grid', () => {
    expect(deriveStartChips(new Array(96).fill(false), 60)).toEqual([]);
  });
});

describe('deriveWeeklySlots', () => {
  // Four consecutive Mondays in July 2026 (2026-07-06 is a Monday).
  const MONDAYS = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'];
  const emptyGrid = () => new Array(96).fill(false);
  // 14:00–15:00 free = indices 56..59.
  function withAfternoon(): boolean[] {
    const g = emptyGrid();
    for (let i = 56; i < 60; i++) g[i] = true;
    return g;
  }

  it('offers a weekly start free in 3 of the 4 occurrences (but not one free in only 2)', () => {
    // 14:00 is free on 3 of 4 Mondays (missing on the 3rd) → OFFERED.
    // 10:00 (indices 40..43) is free on only 2 Mondays → NOT offered.
    function tenAndTwo(): boolean[] {
      const g = emptyGrid();
      for (let i = 40; i < 44; i++) g[i] = true; // 10:00–11:00
      for (let i = 56; i < 60; i++) g[i] = true; // 14:00–15:00
      return g;
    }
    const dates = [
      { date: MONDAYS[0], slots: tenAndTwo() }, // 10:00 + 14:00
      { date: MONDAYS[1], slots: withAfternoon() }, // 14:00 only
      { date: MONDAYS[2], slots: emptyGrid() }, // nothing (14:00 missing here)
      { date: MONDAYS[3], slots: tenAndTwo() }, // 10:00 + 14:00
    ];
    // 14:00 appears on Mondays 0,1,3 = 3/4 → offered. 10:00 on 0,3 = 2/4 → no.
    const slots = deriveWeeklySlots(dates, 60);
    expect(slots).toContainEqual({ day: 'mon', startTime: '14:00' });
    expect(slots).not.toContainEqual({ day: 'mon', startTime: '10:00' });
  });

  it('does not offer a weekly start free in only 2 of 4 occurrences', () => {
    const dates = [
      { date: MONDAYS[0], slots: withAfternoon() },
      { date: MONDAYS[1], slots: withAfternoon() },
      { date: MONDAYS[2], slots: emptyGrid() },
      { date: MONDAYS[3], slots: emptyGrid() },
    ];
    expect(deriveWeeklySlots(dates, 60)).toEqual([]);
  });

  it('keys candidates by the correct weekday and de-dups across occurrences', () => {
    const tuesday = '2026-07-07';
    const dates = [
      { date: MONDAYS[0], slots: withAfternoon() },
      { date: MONDAYS[1], slots: withAfternoon() },
      { date: MONDAYS[2], slots: withAfternoon() },
      { date: tuesday, slots: withAfternoon() },
    ];
    // Only Monday reaches 3/4; Tuesday has a single occurrence → not offered.
    const slots = deriveWeeklySlots(dates, 60);
    expect(slots).toEqual([{ day: 'mon', startTime: '14:00' }]);
  });
});

// ── Per-slot location tags (issue #166) ──

import {
  effectiveLocationsForSlot,
  effectiveLocationsForWeeklySlot,
} from '../bookingSlots';

describe('effectiveLocationsForSlot', () => {
  const PREFS = ['online', 'family_home'];

  it('falls back to profile prefs when the response has no ranges (stale server)', () => {
    expect(effectiveLocationsForSlot(undefined, 56, 60, PREFS)).toEqual(PREFS);
  });

  it('returns the single overlapping range set', () => {
    const ranges = [{ startIdx: 56, endIdx: 60, locations: ['family_home'] }];
    expect(effectiveLocationsForSlot(ranges, 56, 60, PREFS)).toEqual(['family_home']);
  });

  it('intersects when the armed slot spans ranges with different sets', () => {
    const ranges = [
      { startIdx: 56, endIdx: 58, locations: ['online', 'family_home'] },
      { startIdx: 58, endIdx: 60, locations: ['online'] },
    ];
    expect(effectiveLocationsForSlot(ranges, 56, 60, PREFS)).toEqual(['online']);
  });

  it('returns an empty set when the spanned ranges are disjoint', () => {
    const ranges = [
      { startIdx: 56, endIdx: 58, locations: ['online'] },
      { startIdx: 58, endIdx: 60, locations: ['family_home'] },
    ];
    expect(effectiveLocationsForSlot(ranges, 56, 60, PREFS)).toEqual([]);
  });

  it('ignores ranges outside the armed slot', () => {
    const ranges = [
      { startIdx: 40, endIdx: 44, locations: ['library'] },
      { startIdx: 56, endIdx: 60, locations: ['online'] },
    ];
    expect(effectiveLocationsForSlot(ranges, 56, 60, PREFS)).toEqual(['online']);
  });
});

describe('effectiveLocationsForWeeklySlot', () => {
  const PREFS = ['online', 'family_home'];

  it('intersects effective sets across bookable occurrences of the weekday', () => {
    // Two Mondays 14:00-15:00 bookable; the second is online-only.
    const dates = [
      {
        date: '2026-07-20',
        slots: gridWith([56, 60]),
        locationRanges: [{ startIdx: 56, endIdx: 60, locations: ['online', 'family_home'] }],
      },
      {
        date: '2026-07-27',
        slots: gridWith([56, 60]),
        locationRanges: [{ startIdx: 56, endIdx: 60, locations: ['online'] }],
      },
    ];
    expect(effectiveLocationsForWeeklySlot(dates, 'mon', 56, 60, PREFS)).toEqual(['online']);
  });

  it('skips non-bookable occurrences and other weekdays', () => {
    const dates = [
      // Tuesday — different weekday, ignored even though tagged library-only.
      {
        date: '2026-07-21',
        slots: gridWith([56, 60]),
        locationRanges: [{ startIdx: 56, endIdx: 60, locations: ['library'] }],
      },
      // Monday but not bookable at 14:00 — ignored.
      {
        date: '2026-07-20',
        slots: gridWith([80, 84]),
        locationRanges: [{ startIdx: 80, endIdx: 84, locations: ['library'] }],
      },
      // Monday bookable — the only occurrence that counts.
      {
        date: '2026-07-27',
        slots: gridWith([56, 60]),
        locationRanges: [{ startIdx: 56, endIdx: 60, locations: ['family_home'] }],
      },
    ];
    expect(effectiveLocationsForWeeklySlot(dates, 'mon', 56, 60, PREFS)).toEqual(['family_home']);
  });

  it('falls back to profile prefs when no occurrence matches', () => {
    expect(effectiveLocationsForWeeklySlot([], 'mon', 56, 60, PREFS)).toEqual(PREFS);
  });
});
