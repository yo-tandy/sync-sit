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
 * The Paris wall-clock maths below reproduces
 * `@ejm/shared-functions/scheduled/parisTime.ts` — do-core cannot depend on
 * shared-functions (it is a leaf types/content package consumed by the
 * frontend too), so the DST-safe conversion is duplicated here as pure code.
 */

const PARIS_TZ = 'Europe/Paris';
const DAY_MS = 24 * 60 * 60 * 1000;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parisClock(instant: Date): WallClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * Converts a Paris wall-clock date ('YYYY-MM-DD') + time ('HH:mm') to the
 * UTC instant it denotes. DST-safe: guesses by pretending the wall time is
 * UTC, then corrects by the observed Paris offset; the second iteration
 * handles guesses that land on the wrong side of a DST transition.
 */
export function parisWallTimeToUtc(date: string, time: string): Date {
  const wallAsUtcMs = new Date(`${date}T${time}:00Z`).getTime();
  let instant = new Date(wallAsUtcMs);
  for (let i = 0; i < 2; i++) {
    const c = parisClock(instant);
    const seenWallAsUtcMs = Date.UTC(
      c.year,
      c.month - 1,
      c.day,
      c.hour,
      c.minute,
      c.second,
    );
    const offsetMs = seenWallAsUtcMs - instant.getTime();
    instant = new Date(wallAsUtcMs - offsetMs);
  }
  return instant;
}

/**
 * The instant a Paris calendar day ends: midnight at the start of the NEXT
 * Paris day. A task dated `2026-03-29` (the 23-hour spring-forward day)
 * expires at `2026-03-29T22:00:00Z`; a winter day ends at `23:00Z`.
 */
export function endOfParisDay(date: string): Date {
  // Next calendar day via UTC arithmetic (calendar-only, so DST-free), then
  // the DST-safe wall-time conversion pins its midnight to Paris.
  const next = new Date(new Date(`${date}T12:00:00Z`).getTime() + DAY_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  const nextDate = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
  return parisWallTimeToUtc(nextDate, '00:00');
}

/** The timing fields expiry depends on — a subset of TaskDoc (§4.1). */
export interface ExpiryTimingFields {
  timing: TaskTiming;
  date: string | null; // fixed
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
 */
export function computeTaskExpiresAt(
  fields: ExpiryTimingFields,
  now: Date,
): Date {
  switch (fields.timing) {
    case 'fixed':
      if (!fields.date) {
        throw new Error('fixed task has no date');
      }
      return endOfParisDay(fields.date);
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
