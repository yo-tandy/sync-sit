import type { FirestoreTimestamp } from './common.js';
import type { DayOfWeek, HolidayMode } from '../constants/index.js';

export interface ScheduleDoc {
  userId: string;
  weekly: Record<DayOfWeek, boolean[]>; // 96 slots per day
  holidayMode: HolidayMode;
  holidayWeekly?: Record<DayOfWeek, boolean[]>; // deprecated, kept for backward compat
  holidaySchedules?: Record<string, Record<DayOfWeek, boolean[]>>; // keyed by holiday period name
  holidayNotes?: string;
  /**
   * Study (#166): optional per-slot location tags over the weekly grid — a
   * SPARSE map per day keyed by slot index ("0".."95"); an absent key means
   * "use the tutor's profile locationPrefs". Values are study LocationPref
   * strings; typed loosely here because shared-core cannot depend on
   * study-core — study-core's sanitizeDayLocations is the read seam that
   * narrows (and junk-filters) them. Sparse maps, not arrays: Firestore
   * forbids directly nested arrays. Ignored by sit.
   */
  weeklyLocations?: Partial<Record<DayOfWeek, Record<string, string[]>>>;
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
