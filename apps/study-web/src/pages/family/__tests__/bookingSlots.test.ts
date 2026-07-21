import { describe, it, expect } from 'vitest';
import { deriveStartChips } from '../bookingSlots';

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
