import { z } from 'zod';

/** Matches a calendar date "YYYY-MM-DD" (shape only; value sanity via refines). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Maximum span a single availability request may cover. */
const MAX_RANGE_DAYS = 28;

/**
 * Whole-day difference between two "YYYY-MM-DD" strings. Uses Date.UTC (never a
 * local-zone parse) so the count is exact and DST-immune — this is a plain
 * subtraction of two UTC midnights, not calendar day-stepping.
 */
function rangeDays(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  return Math.round((endMs - startMs) / 86_400_000);
}

/**
 * True only if the string names a real calendar date. The regex admits shapes
 * like 2026-13-01 or 2026-02-30; Date.UTC normalizes overflow (never throws),
 * so a round-trip that lands on different components means the date is bogus.
 */
function isValidCalendarDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Input for getTutorAvailability. The callerFamilyId is NEVER accepted from the
 * client — it is derived server-side from the caller's parent profile.
 */
export const getTutorAvailabilitySchema = z
  .object({
    tutorUserId: z.string().min(1, 'tutorUserId is required'),
    startDate: z.string().regex(DATE_RE, 'startDate must be YYYY-MM-DD'),
    endDate: z.string().regex(DATE_RE, 'endDate must be YYYY-MM-DD'),
  })
  .refine((d) => isValidCalendarDate(d.startDate), {
    message: 'startDate is not a real calendar date',
    path: ['startDate'],
  })
  .refine((d) => isValidCalendarDate(d.endDate), {
    message: 'endDate is not a real calendar date',
    path: ['endDate'],
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })
  .refine((d) => rangeDays(d.startDate, d.endDate) <= MAX_RANGE_DAYS, {
    message: `Date range must not exceed ${MAX_RANGE_DAYS} days`,
    path: ['endDate'],
  });

export type GetTutorAvailabilityInput = z.infer<typeof getTutorAvailabilitySchema>;
