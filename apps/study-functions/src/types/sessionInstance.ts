import type { FirestoreTimestamp } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import type { InstanceStatus } from './status.js';

/**
 * One concrete occurrence of a recurring tutoring session.
 * Stored as a subcollection: `study-sessions/{sessionId}/instances/{instanceId}`.
 */
export interface SessionInstanceDoc {
  instanceId: string;
  sessionId: string; // parent recurring session
  familyId: string;
  tutorUserId: string;

  // Concrete occurrence
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  sessionLengthMinutes: number;
  paddingMinutes: number;

  // Status (independent of parent session)
  status: InstanceStatus;
  cancelledAt?: FirestoreTimestamp;
  rescheduledTo?: string; // new date if rescheduled

  // Denormalized for display
  subject: string;
  level: string;
  rate: number;
  location: LocationPref;

  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}
