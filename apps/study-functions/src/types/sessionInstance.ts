import type { FirestoreTimestamp } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import type { InstanceStatus } from './status.js';

/**
 * One concrete occurrence of a recurring tutoring session.
 * Stored as a subcollection: `study-sessions/{sessionId}/instances/{instanceId}`.
 *
 * CONSCIOUS SCAFFOLD AMENDMENT — `instanceId` IS the occurrence date string
 * "YYYY-MM-DD" (one instance per date per series). This makes generation
 * idempotent (extendRecurring create-if-absent keys on the date) and gives O(1)
 * lookup from a per-date override ledger block back to its instance.
 *
 * AUTHORITY SPLIT (see SessionDoc): this doc's `status` governs the OCCURRENCE
 * independently of the parent series. Instances are created ONLY for a confirmed
 * series (never for a pending request). Holiday-skipped dates get NO instance;
 * a date the tutor is no longer free for gets an instance with status
 * 'cancelled' + statusReason 'conflict_skip' — a visible gap, not a silent one.
 * 'rescheduled' is in the InstanceStatus vocabulary but is NEVER written in v1.
 */
export interface SessionInstanceDoc {
  instanceId: string; // === `date` below ("YYYY-MM-DD")
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
  // Why this occurrence is off (only set when status !== 'scheduled').
  statusReason?: 'cancelled_by_family' | 'cancelled_by_tutor' | 'conflict_skip';
  cancelledAt?: FirestoreTimestamp;
  cancellationReason?: string; // free-text/enum reason captured on cancel
  rescheduledTo?: string; // new date if rescheduled (never written in v1)
  completedAt?: FirestoreTimestamp;

  // Pre-session reminder fan-out guard (set once the reminder is dispatched).
  reminderSent?: boolean;

  // ── Session notes (V1.1 feature 1; set via the setSessionNote callable) ──
  // Recurring notes live PER-OCCURRENCE here (one_time notes live on SessionDoc).
  // FAMILY-authored pre-note, editable until this occurrence's start time passes.
  preSessionNote?: string;
  // TUTOR-authored post-note, writable once this occurrence has started.
  postSessionNote?: string;

  // Denormalized for display
  subject: string;
  level: string;
  rate: number;
  location: LocationPref;

  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}
