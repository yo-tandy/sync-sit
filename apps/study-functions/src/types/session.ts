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

  // Who (students on the session). `studentIds` reference
  // families/{familyId}/kids; `students` is a denormalized snapshot so the
  // tutor — who cannot read the family's kids subcollection — can display the
  // roster. Denormalized at book time and never resynced.
  studentIds: string[];
  students: { firstName: string; age: number }[];

  // Denormalized display names. Parents cannot read tutor docs and tutors
  // cannot read family docs (StudyContactRequestDoc precedent), so each party's
  // name is snapshotted here at book time so the counterparty can render it.
  familyName: string;
  parentName: string;
  tutorName: string;

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

  // Optional free-text note from the family to the tutor, captured at book time.
  message?: string;

  // Padding (stored for override calculation)
  paddingMinutes: number;

  // Status
  status: SessionStatus;
  statusReason?: string;
  cancellationReason?: string; // free-text/enum reason captured on cancel
  cancelledFromStatus?: SessionStatus; // status the session held before cancel

  // Reminder fan-out guard (set once the pre-session reminder is dispatched)
  reminderSent?: boolean;

  // Provenance: the accepted contact request that unlocked this booking
  contactRequestId?: string;

  // Timestamps
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  confirmedAt?: FirestoreTimestamp;
  cancelledAt?: FirestoreTimestamp;
  completedAt?: FirestoreTimestamp;

  // Modification tracking (same pattern as sync-sit)
  modified?: boolean;
  modifiedAt?: FirestoreTimestamp;
  modifiedFields?: string[];
}
