import type { HolidayPeriod } from '@ejm/shared';

/**
 * Get a contextual tag for a babysitting date.
 *
 * Returns:
 * - Holiday period name if the date falls during or the evening before a holiday
 * - "school_night" if it's a Sun–Thu evening (after 18h) outside holidays
 * - null otherwise (Fri/Sat evening, daytime, etc.)
 */
export function getDateTag(
  date: string,
  startTime: string,
  periods: HolidayPeriod[]
): string | null {
  if (!date || !startTime) return null;

  // Only tag evening appointments (18h+)
  const hour = parseInt(startTime.split(':')[0], 10);
  if (isNaN(hour) || hour < 18) return null;

  // Check if date falls within any holiday period
  for (const period of periods) {
    if (date >= period.startDate && date <= period.endDate) {
      return period.name;
    }
  }

  // Check if date is the evening before a holiday starts
  const nextDay = new Date(date + 'T00:00:00');
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split('T')[0];

  for (const period of periods) {
    if (nextDayStr === period.startDate) {
      return period.name;
    }
  }

  // Check day of week: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4
  const dayOfWeek = new Date(date + 'T00:00:00').getDay();
  if (dayOfWeek >= 0 && dayOfWeek <= 4) {
    return 'school_night';
  }

  return null;
}
