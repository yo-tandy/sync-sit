import { parisWallTimeToUtc } from '@ejm/shared-functions/scheduled/parisTime.js';
import { ADMIN_CONFIG_DEFS } from '@ejm/shared-core';

/**
 * Default-parameter fallback only: every production call site passes the
 * configured bookingNoticeHours (issue #250) explicitly, so this links to
 * the table default rather than carrying its own copy.
 */
export const RECURRING_NOTICE_HOURS = ADMIN_CONFIG_DEFS.bookingNoticeHours.default;

/**
 * Drop candidate dates whose occurrence START is within the notice window.
 *
 * Recurring candidate expansion is anchored at the DATE of now+24h (day
 * granularity), so the FIRST occurrence can fall up to ~a day's slot-time inside
 * the precise 24h window — e.g. a 10:00 slot on a date whose midnight is <24h
 * out. That date is NOT a tutor conflict; it is a notice artifact. It must be
 * dropped ENTIRELY (no instance) — exactly like a holiday drop — rather than
 * materialized as a visible 'cancelled'/conflict_skip gap (which would also fire
 * a spurious 'cancelled'-pref family notification for a non-conflict).
 *
 * The cutoff is the precise per-slot instant (parisWallTimeToUtc — DST-safe), so
 * it is the single source of truth for recurring notice: generateInstances then
 * runs availability with NO notice window, and a within-notice date can never be
 * mis-marked as a conflict. SHARED by respondToSession's recurring confirm and
 * (PR 3 Task 3) extendRecurring so both anchor and drop identically.
 */
export function dropWithinNotice(
  candidateDates: string[],
  startTime: string,
  now: Date,
  noticeHours: number = RECURRING_NOTICE_HOURS,
): string[] {
  const cutoff = now.getTime() + noticeHours * 60 * 60 * 1000;
  return candidateDates.filter(
    (date) => parisWallTimeToUtc(date, startTime).getTime() >= cutoff,
  );
}
