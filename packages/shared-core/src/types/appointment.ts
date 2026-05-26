import type { DayOfWeek } from '../constants/config.js';

/**
 * A single recurring weekly slot. Used by sync-sit's babysitting recurring
 * searches/appointments and by sync-study's recurring tutoring sessions.
 */
export interface RecurringSlot {
  day: DayOfWeek;
  startTime: string; // "HH:MM"
  endTime: string;
}
