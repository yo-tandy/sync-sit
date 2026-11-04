import { describe, it, expect } from 'vitest';
import {
  rangeSlotIndices,
  timeRangeSlotIndices,
  slotInRange,
  areSlotsAvailable,
  setSlotRange,
  createEmptySlots,
  createFullSlots,
} from '../schedule.js';

// Issue #510: a slot range that crosses midnight (22:00 → 02:00) lives in ONE
// day's array as 88..95 then 0..7 (the DayEditor storage convention). Every
// reader must walk both runs; the naive `for (i = start; i < end)` loop ran
// zero times and read as "all clear".

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, k) => a + k);

describe('rangeSlotIndices', () => {
  it('walks a plain range end-exclusive', () => {
    expect(rangeSlotIndices(64, 68)).toEqual([64, 65, 66, 67]);
  });

  it('walks a wrapped range as start..95 then 0..end-1 on the same array', () => {
    expect(rangeSlotIndices(88, 8)).toEqual([...range(88, 96), ...range(0, 8)]);
  });

  it('treats end === SLOTS_PER_DAY (a "24:00" end) as a plain range to end of day, not a wrap', () => {
    expect(rangeSlotIndices(88, 96)).toEqual(range(88, 96));
  });

  it('treats start === end as a full-day wrap (an end not after the start crosses midnight)', () => {
    expect(rangeSlotIndices(40, 40)).toHaveLength(96);
  });

  it('clamps out-of-range indices instead of reading past the array', () => {
    expect(rangeSlotIndices(-5, 3)).toEqual([0, 1, 2]);
    expect(rangeSlotIndices(90, 200)).toEqual(range(90, 96));
  });
});

describe('timeRangeSlotIndices', () => {
  it('22:00 → 02:00 covers 88..95 and 0..7', () => {
    expect(timeRangeSlotIndices('22:00', '02:00')).toEqual([...range(88, 96), ...range(0, 8)]);
  });

  it('10:00 → 13:00 covers 40..51', () => {
    expect(timeRangeSlotIndices('10:00', '13:00')).toEqual(range(40, 52));
  });
});

describe('slotInRange', () => {
  it('plain range: inside, at end (exclusive), outside', () => {
    expect(slotInRange(70, 64, 80)).toBe(true);
    expect(slotInRange(80, 64, 80)).toBe(false);
    expect(slotInRange(10, 64, 80)).toBe(false);
  });

  it('wrapped range covers both sides of midnight and nothing in between', () => {
    expect(slotInRange(90, 88, 8)).toBe(true);
    expect(slotInRange(2, 88, 8)).toBe(true);
    expect(slotInRange(8, 88, 8)).toBe(false);
    expect(slotInRange(50, 88, 8)).toBe(false);
  });

  it('never matches an index outside the array', () => {
    expect(slotInRange(96, 88, 8)).toBe(false);
    expect(slotInRange(-1, 88, 8)).toBe(false);
  });
});

describe('areSlotsAvailable (wrap-aware)', () => {
  it('an overnight sitting needs BOTH runs open', () => {
    const open = createFullSlots();
    expect(areSlotsAvailable(open, '22:00', '02:00')).toBe(true);

    const closedAfterMidnight = [...open];
    closedAfterMidnight[3] = false; // 00:45 busy
    expect(areSlotsAvailable(closedAfterMidnight, '22:00', '02:00')).toBe(false);

    const closedBeforeMidnight = [...open];
    closedBeforeMidnight[92] = false; // 23:00 busy
    expect(areSlotsAvailable(closedBeforeMidnight, '22:00', '02:00')).toBe(false);
  });

  it('is NOT vacuously true for a wrapped range on an empty grid (the #510 bug)', () => {
    expect(areSlotsAvailable(createEmptySlots(), '22:00', '02:00')).toBe(false);
  });

  it('still checks a plain range', () => {
    const slots = createFullSlots();
    slots[45] = false;
    expect(areSlotsAvailable(slots, '10:00', '13:00')).toBe(false);
    expect(areSlotsAvailable(slots, '13:00', '15:00')).toBe(true);
  });
});

describe('setSlotRange (wrap-aware)', () => {
  it('writes both runs of an overnight range into the same array', () => {
    const out = setSlotRange(createEmptySlots(), '22:00', '02:00', true);
    expect(out.filter(Boolean)).toHaveLength(16);
    expect(out[88]).toBe(true);
    expect(out[95]).toBe(true);
    expect(out[0]).toBe(true);
    expect(out[7]).toBe(true);
    expect(out[8]).toBe(false);
    expect(out[87]).toBe(false);
  });

  it('does not mutate its input', () => {
    const input = createEmptySlots();
    setSlotRange(input, '22:00', '02:00', true);
    expect(input.some(Boolean)).toBe(false);
  });
});
