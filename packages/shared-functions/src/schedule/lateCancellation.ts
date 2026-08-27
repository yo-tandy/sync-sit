import { CANCELLATION_NOTICE_PRESETS } from '@ejm/shared-core';
import { parisWallTimeToUtc } from '../scheduled/parisTime.js';

/**
 * The ONE lateness definition both apps share (moved from study-functions in
 * issue #237, which ported the notice-window system to sit): true when
 * cancelling now, a commitment starting at `date`+`startTime` (Paris wall
 * clock) falls inside the `noticeHours` cancellation window.
 * Strict `<`: cancelling exactly at the cutoff is on-time. A cancel after the
 * start has trivially violated any window. noticeHours <= 0 → never late.
 */
export function isLateCancellation(
  date: string,
  startTime: string,
  noticeHours: number,
  now: Date,
): boolean {
  if (noticeHours <= 0) return false;
  const start = parisWallTimeToUtc(date, startTime);
  return start.getTime() < now.getTime() + noticeHours * 60 * 60 * 1000;
}

/**
 * Clamp a stored notice window to the preset set at SNAPSHOT time (PR #248
 * round 3 residual): profile values written before the rules constrained the
 * field to the presets are grandfathered forever by the diff-gate, so every
 * snapshot site normalizes here -- rounding DOWN to the nearest preset, never
 * classifying more cancellations late than a real preset would.
 */
export function clampNoticeWindow(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  let best = 0;
  for (const p of CANCELLATION_NOTICE_PRESETS) {
    if (p <= v && p > best) best = p;
  }
  return best;
}
