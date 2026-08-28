import { parisWallTimeToUtc } from '@ejm/shared-core/utils/parisTime.js';
import type { TaskTiming } from '../types/task.js';
import { DO_ONGOING_TTL_DAYS } from '../constants/bounds.js';

/**
 * Server-computed task expiry (plan §6.3), as a pure function so it is
 * unit-testable (§14). `doPostTask` / `doUpdateTask` call it and write the
 * result; it is never client-supplied.
 *
 * | Timing      | expiresAt                                                  |
 * |-------------|------------------------------------------------------------|
 * | `fixed`     | end of the task's day, Paris wall clock                    |
 * | `deadline`  | end of `dueDate`                                           |
 * | `recurring` | end of `startDate` — the board offer window closes when    |
 * |             | the series starts                                          |
 * | `ongoing`   | `now + DO_ONGOING_TTL_DAYS` (14d), renewable via any owner |
 * |             | edit                                                       |
 *
 * Dated tasks are NOT capped at a TTL: a `min(now + 14d, …)` cap would
 * hard-delete a far-out task before its own date (a family posting "help me
 * move on 15 October" in late August would watch the post vanish five weeks
 * before the move). The TTL exists to keep UNDATED demand from going stale,
 * so it applies only to `ongoing`; a dated task's own date IS its staleness
 * bound.
 *
 * The Paris wall-clock maths (`parisWallTimeToUtc`, DST-safe via the #74
 * two-pass offset correction) is the shared implementation in
 * `@ejm/shared-core/utils/parisTime.ts` — the hoist tracked as issue #309.
 * Re-exported below so expiry's callers and tests keep one import site; the
 * import-identity test in `__tests__/expiry.test.ts` pins do-core to the
 * shared copy.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export { parisWallTimeToUtc };

/**
 * The instant a Paris calendar day ends: midnight at the start of the NEXT
 * Paris day. A task dated `2026-03-29` (the 23-hour spring-forward day)
 * expires at `2026-03-29T22:00:00Z`; a winter day ends at `23:00Z`.
 */
export function endOfParisDay(date: string): Date {
  return parisWallTimeToUtc(nextCalendarDay(date), '00:00');
}

/** 'YYYY-MM-DD' + 1 day, via UTC arithmetic (calendar-only, so DST-free). */
function nextCalendarDay(date: string): string {
  const next = new Date(new Date(`${date}T12:00:00Z`).getTime() + DAY_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** The timing fields expiry depends on — a subset of TaskDoc (§4.1). */
export interface ExpiryTimingFields {
  timing: TaskTiming;
  date: string | null; // fixed
  startTime: string | null; // fixed — midnight-crossing detection (below)
  endTime: string | null; // fixed
  dueDate: string | null; // deadline
  startDate: string | null; // recurring | ongoing
}

/**
 * Compute `expiresAt` for a task per the §6.3 table. Throws on a task whose
 * timing group is missing its date — validate with `validateTaskTiming`
 * first; the throw here keeps a malformed task from silently getting an
 * `Invalid Date` expiry. The `default` throws on a discriminant outside the
 * union for the same reason, only worse: without it the switch falls off the
 * end and returns `undefined` into a `Date`-typed slot, and `doPostTask`
 * would write a task with no expiry that the §6.5 sweep never collects.
 *
 * A `fixed` task with `endTime <= startTime` crosses midnight and ENDS on
 * the next calendar day (validateTaskTiming legalizes the shape; both
 * halves of publishSearch's one_time precedent, PR #210 review, apply):
 * "the task's day" for expiry purposes is the day the task actually ends,
 * so a 20:00–01:00 clean-up dated the 12th expires at the end of the 13th —
 * not one hour before it finishes.
 */
export function computeTaskExpiresAt(
  fields: ExpiryTimingFields,
  now: Date,
): Date {
  switch (fields.timing) {
    case 'fixed': {
      if (!fields.date) {
        throw new Error('fixed task has no date');
      }
      const crossesMidnight =
        fields.startTime !== null &&
        fields.endTime !== null &&
        fields.endTime <= fields.startTime;
      return endOfParisDay(
        crossesMidnight ? nextCalendarDay(fields.date) : fields.date,
      );
    }
    case 'deadline':
      if (!fields.dueDate) {
        throw new Error('deadline task has no dueDate');
      }
      return endOfParisDay(fields.dueDate);
    case 'recurring':
      if (!fields.startDate) {
        throw new Error('recurring task has no startDate');
      }
      return endOfParisDay(fields.startDate);
    case 'ongoing':
      return new Date(now.getTime() + DO_ONGOING_TTL_DAYS * DAY_MS);
    default: {
      // Exhaustiveness pin: a fifth TaskTiming without a case here is a
      // compile error, and a runtime value outside the union throws instead
      // of silently minting an expiry-less task.
      const exhaustive: never = fields.timing;
      throw new Error(`unknown task timing: ${String(exhaustive)}`);
    }
  }
}
