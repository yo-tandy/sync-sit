import { describe, it, expect } from 'vitest';
import { isLateCancellation } from '../lateCancellation.js';

// Paris is UTC+2 on 2026-07-30 (CEST): 10:00 wall = 08:00Z.
const now = new Date('2026-07-29T08:00:00Z'); // exactly 24h before start

describe('isLateCancellation', () => {
  it('flags a cancel strictly inside the window', () => {
    expect(isLateCancellation('2026-07-30', '10:00', 48, now)).toBe(true);
  });
  it('does not flag exactly AT the cutoff (strict <)', () => {
    expect(isLateCancellation('2026-07-30', '10:00', 24, now)).toBe(false);
  });
  it('does not flag outside the window', () => {
    expect(isLateCancellation('2026-08-10', '10:00', 48, now)).toBe(false);
  });
  it('noticeHours 0 never flags, even seconds before start', () => {
    expect(isLateCancellation('2026-07-29', '10:05', 0, now)).toBe(false);
  });
  it('a cancel AFTER the start is late (start already inside any window)', () => {
    expect(isLateCancellation('2026-07-28', '10:00', 24, now)).toBe(true);
  });
  it('handles the CET/CEST boundary (2026-10-25 fall-back date)', () => {
    // 2026-10-26 09:00 Paris = 08:00Z (CET, UTC+1 after the 10-25 fall-back).
    // 47h before = 2026-10-24T09:00:00Z → inside a 48h window.
    expect(isLateCancellation('2026-10-26', '09:00', 48, new Date('2026-10-24T09:00:00Z'))).toBe(
      true,
    );
    // 49h before = 2026-10-24T07:00:00Z → outside.
    expect(isLateCancellation('2026-10-26', '09:00', 48, new Date('2026-10-24T07:00:00Z'))).toBe(
      false,
    );
  });
});
