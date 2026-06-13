import { describe, it, expect } from 'vitest';
import {
  timeToSlotIndex,
  slotIndexToTime,
  areSlotsAvailable,
  createEmptySlots,
  createFullSlots,
  setSlotRange,
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
