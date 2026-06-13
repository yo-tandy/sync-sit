import type { FirestoreTimestamp, LatLng } from '@ejm/shared-core';
import type { RecurringSlot } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import type { SessionStatus } from './status.js';

/**
 * A tutoring session document (sync-study equivalent of sync-sit's
 * AppointmentDoc). Stored in `study-sessions/{sessionId}`.
 */
export interface SessionDoc {
  sessionId: string;
  familyId: string;
  tutorUserId: string;
  createdByUserId: string;

  // What
  subject: string;
  level: string;
  rate: number; // locked-in per-subject rate at time of booking

  // When
  type: 'one_time' | 'recurring';
  date?: string; // one-time: "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM" (calculated from startTime + sessionLengthMinutes)
  sessionLengthMinutes: number;
  recurringSlots?: RecurringSlot[];
  schoolWeeksOnly?: boolean;

  // Where
  location: LocationPref;
  address?: string;
  latLng?: LatLng;

  // Padding (stored for override calculation)
  paddingMinutes: number;

  // Status
  status: SessionStatus;
  statusReason?: string;

  // Timestamps
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  confirmedAt?: FirestoreTimestamp;
  cancelledAt?: FirestoreTimestamp;

  // Modification tracking (same pattern as sync-sit)
  modified?: boolean;
  modifiedAt?: FirestoreTimestamp;
  modifiedFields?: string[];
}
