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
  // Who initiated: absent/`'family'` = a family-initiated request (the tutor
  // confirms); `'provider'` = a TUTOR PROPOSAL (V1.1 feature 3) the FAMILY
  // confirms, picking students at accept. Drives the pending-row rendering on
  // both portals (family sees Accept/Decline; tutor sees "Awaiting the family").
  proposedBy?: 'provider' | 'family';
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
  // Recurring only (V1.1): the family asked for the first session to be a trial.
  // Both portals badge it; the per-occurrence marker is StudySessionInstanceDoc.isTrial.
  trialFirstSession?: boolean;
  endDate?: string;
  location: LocationPref;
  message?: string;
  // Session notes (V1.1): family-authored pre-note, tutor-authored post-note.
  // For a one_time session these live on this doc; recurring notes live per
  // instance (see StudySessionInstanceDoc).
  preSessionNote?: string;
  postSessionNote?: string;
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'modified' | 'completed';
  statusReason?: string;
  // ── Cancellation policy (V2 feature 7) ──
  // Snapshot of the tutor's policy taken at request creation (0 = no policy).
  // Drives the client-side late-cancel warning; the server flag is authoritative.
  cancellationNoticeHours?: number;
  // Set true (one_time only) by the backend when this session was cancelled
  // inside the notice window while confirmed. Recurring lateness is per-instance.
  lateCancellation?: boolean;
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
  // The first materialized occurrence of a trial series (V1.1); badged in the list.
  isTrial?: boolean;
  // Set true by the backend when this occurrence was cancelled inside the parent
  // series' notice window while scheduled (V2 feature 7). Only ever written true.
  lateCancellation?: boolean;
  location: LocationPref;
  // Per-occurrence session notes (V1.1); see StudySessionDoc.
  preSessionNote?: string;
  postSessionNote?: string;
}
