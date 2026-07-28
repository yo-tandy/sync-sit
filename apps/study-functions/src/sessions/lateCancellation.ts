import { parisWallTimeToUtc } from '@ejm/shared-functions/scheduled/parisTime.js';

/**
 * True when cancelling now, a commitment starting at `date`+`startTime`
 * (Paris wall clock) falls inside the `noticeHours` cancellation window.
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
