import { describe, it, expect } from 'vitest';
import { isLateCancellation } from '../lateCancellation.js';
import { clampNoticeWindow } from '@ejm/shared-functions/schedule/lateCancellation.js';

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

describe('clampNoticeWindow', () => {
  it('passes presets through unchanged', () => {
    expect(clampNoticeWindow(0)).toBe(0);
    expect(clampNoticeWindow(24)).toBe(24);
    expect(clampNoticeWindow(48)).toBe(48);
    expect(clampNoticeWindow(168)).toBe(168);
  });
  it('rounds a grandfathered out-of-set value DOWN to the nearest preset', () => {
    // Pre-rules legacy values survive via the rules diff-gate; the snapshot
    // normalizes them, never flagging more than a real preset would.
    expect(clampNoticeWindow(100)).toBe(48);
    expect(clampNoticeWindow(12)).toBe(0);
    expect(clampNoticeWindow(999)).toBe(168);
  });
  it('treats garbage as no policy', () => {
    expect(clampNoticeWindow(undefined)).toBe(0);
    expect(clampNoticeWindow(-5)).toBe(0);
    expect(clampNoticeWindow(NaN)).toBe(0);
    expect(clampNoticeWindow('48')).toBe(0);
  });
});
