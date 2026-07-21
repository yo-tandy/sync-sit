import type { RecurringSlot } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';

/**
 * Client-facing shapes of the session-booking Firestore docs — the subset the
 * tutor UI reads. The authoritative types live in study-functions (SessionDoc /
 * SessionInstanceDoc); this app cannot import across the function boundary, so
 * we mirror only the fields we render. Shared by the tutor SessionsPage, the
 * RecurringConflictPreview, and the session-management views.
 */

/** A `study-sessions/{sessionId}` document. */
export interface StudySessionDoc {
  sessionId: string;
  familyId: string;
  tutorUserId: string;
  subject: string;
  level: string;
  rate: number;
  students: { firstName: string; age: number }[];
  familyName: string;
  parentName: string;
  tutorName: string;
  type: 'one_time' | 'recurring';
  date?: string;
  startTime: string;
  endTime?: string;
  recurringSlots?: RecurringSlot[];
  schoolWeeksOnly?: boolean;
  endDate?: string;
  location: LocationPref;
  message?: string;
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'modified' | 'completed';
  statusReason?: string;
  createdAt?: { seconds?: number } | null;
}

/** A `study-sessions/{sessionId}/instances/{instanceId}` occurrence (id === date). */
export interface StudySessionInstanceDoc {
  instanceId: string;
  sessionId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'scheduled' | 'cancelled' | 'completed' | 'rescheduled';
  statusReason?: 'cancelled_by_family' | 'cancelled_by_tutor' | 'conflict_skip';
  location: LocationPref;
}
