import type { FirestoreTimestamp } from './common.js';
import type { DayOfWeek, HolidayMode } from '../constants/index.js';

export interface ScheduleDoc {
  userId: string;
  weekly: Record<DayOfWeek, boolean[]>; // 96 slots per day
  holidayMode: HolidayMode;
  holidayWeekly?: Record<DayOfWeek, boolean[]>; // deprecated, kept for backward compat
  holidaySchedules?: Record<string, Record<DayOfWeek, boolean[]>>; // keyed by holiday period name
  holidayNotes?: string;
  updatedAt: FirestoreTimestamp;
}

export interface ScheduleOverrideDoc {
  date: string; // "YYYY-MM-DD"
  type: 'unavailable' | 'custom';
  slots?: boolean[]; // 96 elements, only if type = 'custom'
  reason?: 'manual' | 'appointment';
  appointmentId?: string;
  createdAt: FirestoreTimestamp;
}
