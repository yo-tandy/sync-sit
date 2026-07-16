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
 * Input for getTutorAvailability. The callerFamilyId is NEVER accepted from the
 * client — it is derived server-side from the caller's parent profile.
 */
export const getTutorAvailabilitySchema = z
  .object({
    tutorUserId: z.string().min(1, 'tutorUserId is required'),
    startDate: z.string().regex(DATE_RE, 'startDate must be YYYY-MM-DD'),
    endDate: z.string().regex(DATE_RE, 'endDate must be YYYY-MM-DD'),
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
