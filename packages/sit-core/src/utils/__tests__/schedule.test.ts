import { describe, it, expect } from 'vitest';
import {
  timeToSlotIndex,
  slotIndexToTime,
  areSlotsAvailable,
  createEmptySlots,
  createFullSlots,
  setSlotRange,
  slotRangeIndices,
  slotRangeCovers,
  timeRangeSlotIndices,
} from '../schedule.js';

describe('timeToSlotIndex', () => {
  it('converts 00:00 to 0', () => {
    expect(timeToSlotIndex('00:00')).toBe(0);
  });

  it('converts 12:00 to 48', () => {
    expect(timeToSlotIndex('12:00')).toBe(48);
  });

  it('converts 23:45 to 95', () => {
    expect(timeToSlotIndex('23:45')).toBe(95);
  });

  it('converts 06:30 to 26', () => {
    expect(timeToSlotIndex('06:30')).toBe(26);
  });
});

describe('slotIndexToTime', () => {
  it('converts 0 to 00:00', () => {
    expect(slotIndexToTime(0)).toBe('00:00');
  });

  it('converts 48 to 12:00', () => {
    expect(slotIndexToTime(48)).toBe('12:00');
  });

  it('converts 95 to 23:45', () => {
    expect(slotIndexToTime(95)).toBe('23:45');
  });

  it('roundtrips with timeToSlotIndex', () => {
    expect(slotIndexToTime(timeToSlotIndex('17:30'))).toBe('17:30');
  });
});

describe('createEmptySlots', () => {
  it('returns 96 false values', () => {
    const slots = createEmptySlots();
    expect(slots).toHaveLength(96);
    expect(slots.every((s) => s === false)).toBe(true);
  });
});

describe('createFullSlots', () => {
  it('returns 96 true values', () => {
    const slots = createFullSlots();
    expect(slots).toHaveLength(96);
    expect(slots.every((s) => s === true)).toBe(true);
  });
});

describe('setSlotRange', () => {
  it('sets specified range to true', () => {
    const slots = setSlotRange(createEmptySlots(), '17:00', '21:00', true);
    // 17:00 = slot 68, 21:00 = slot 84 — slots 68-83 should be true
    expect(slots[68]).toBe(true);
    expect(slots[83]).toBe(true);
    expect(slots[67]).toBe(false);
    expect(slots[84]).toBe(false);
  });

  it('does not mutate the original array', () => {
    const original = createEmptySlots();
    setSlotRange(original, '10:00', '12:00', true);
    expect(original.every((s) => s === false)).toBe(true);
  });
});

describe('areSlotsAvailable', () => {
  it('returns true when all slots in range are available', () => {
    const slots = setSlotRange(createEmptySlots(), '17:00', '22:00', true);
    expect(areSlotsAvailable(slots, '18:00', '21:00')).toBe(true);
  });

  it('returns false when any slot in range is unavailable', () => {
    const slots = setSlotRange(createEmptySlots(), '17:00', '19:00', true);
    expect(areSlotsAvailable(slots, '17:00', '21:00')).toBe(false);
  });

  it('returns true for full slots with any range', () => {
    expect(areSlotsAvailable(createFullSlots(), '00:00', '23:45')).toBe(true);
  });
});

// ── Issue #510: overnight ranges ──────────────────────────────────────────
// Every consumer walked a range as `for (i = startIdx; i < endIdx; i++)`,
// which has ZERO iterations for 22:00 -> 02:00 (i = 88; i < 8). Search read
// that as "all clear" and passed every babysitter; the slot-claim path read it
// as "nothing to do" and let a confirmed booking claim no slots at all.

describe('slotRangeIndices (past-midnight wrap)', () => {
  it('walks a normal range as a half-open interval', () => {
    expect(slotRangeIndices(72, 76)).toEqual([72, 73, 74, 75]);
  });

  it('wraps 22:00 -> 02:00 to 88..95 then 0..7', () => {
    expect(slotRangeIndices(88, 8)).toEqual([
      88, 89, 90, 91, 92, 93, 94, 95, 0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('treats an end of 00:00 as midnight, not as an empty range', () => {
    // The single most common overnight shape: 18:00 -> 00:00 is 72..95.
    expect(slotRangeIndices(72, 0)).toEqual(
      Array.from({ length: 24 }, (_, k) => 72 + k),
    );
  });

  it('reads start === end as a full 24 hours, never as an empty range', () => {
    // Degenerate input, but a silent [] is the exact failure this issue is
    // about. The full day falls out of the one wrap rule and agrees with
    // publishSearch's reading of the same shape ('an endTime that is not
    // after startTime crosses midnight, so the sitting ends 24h later') and
    // with DayEditor's old hand-rolled wrap, which did the same. Both
    // directions of error are safe here: search demands more availability,
    // the claim path blocks more slots — neither double-books anyone.
    const all = slotRangeIndices(72, 72);
    expect(all).toHaveLength(96);
    expect(new Set(all).size).toBe(96);
    expect(all[0]).toBe(72);
  });

  it('matches the DayEditor convention: both halves land in ONE day array', () => {
    // The wrap is day-local. A reader that looked at day D+1 would not find
    // what DayEditor's addWrappingRange wrote.
    const idxs = timeRangeSlotIndices('22:00', '02:00');
    expect(idxs.filter((i) => i >= 88)).toHaveLength(8);
    expect(idxs.filter((i) => i < 8)).toHaveLength(8);
  });
});

describe('slotRangeCovers (membership form of the same rule)', () => {
  it('agrees with slotRangeIndices on a normal range', () => {
    for (let i = 0; i < 96; i++) {
      expect(slotRangeCovers(i, 72, 76)).toBe(slotRangeIndices(72, 76).includes(i));
    }
  });

  it('agrees with slotRangeIndices on a wrapping range', () => {
    for (let i = 0; i < 96; i++) {
      expect(slotRangeCovers(i, 88, 8)).toBe(slotRangeIndices(88, 8).includes(i));
    }
  });
});

describe('areSlotsAvailable across midnight', () => {
  it('is FALSE when the small hours are not free (was vacuously true)', () => {
    // The sitter offers 22:00-24:00 but nothing after midnight.
    const slots = setSlotRange(createEmptySlots(), '22:00', '00:00', true);
    expect(areSlotsAvailable(slots, '22:00', '02:00')).toBe(false);
  });

  it('is FALSE when the evening half is not free either', () => {
    const slots = setSlotRange(createEmptySlots(), '00:00', '02:00', true);
    expect(areSlotsAvailable(slots, '22:00', '02:00')).toBe(false);
  });

  it('is TRUE only when BOTH halves are free', () => {
    let slots = setSlotRange(createEmptySlots(), '22:00', '00:00', true);
    slots = setSlotRange(slots, '00:00', '02:00', true);
    expect(areSlotsAvailable(slots, '22:00', '02:00')).toBe(true);
  });
});

describe('setSlotRange across midnight', () => {
  it('writes both halves (it used to write nothing)', () => {
    const slots = setSlotRange(createEmptySlots(), '22:00', '02:00', true);
    expect(slots.filter(Boolean)).toHaveLength(16);
    expect(slots[88]).toBe(true);
    expect(slots[95]).toBe(true);
    expect(slots[0]).toBe(true);
    expect(slots[7]).toBe(true);
    // ...and nothing in between.
    expect(slots[8]).toBe(false);
    expect(slots[87]).toBe(false);
  });

  it('clears both halves symmetrically', () => {
    const on = setSlotRange(createFullSlots(), '22:00', '02:00', false);
    expect(on[88]).toBe(false);
    expect(on[0]).toBe(false);
    expect(on[8]).toBe(true);
  });
});
