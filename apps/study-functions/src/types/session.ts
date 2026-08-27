import type { FirestoreTimestamp, LatLng } from '@ejm/shared-core';
import type { RecurringSlot, ProposedBy } from '@ejm/shared-core';
import type { LocationPref } from '@ejm/study-core';
import type { SessionStatus } from './status.js';

/**
 * A tutoring session document (sync-study equivalent of sync-sit's
 * AppointmentDoc). Stored in `study-sessions/{sessionId}`.
 *
 * AUTHORITY SPLIT (milestone design): for a recurring series this parent doc's
 * `status` governs the SERIES lifecycle (pending → confirmed → cancelled |
 * completed). The concrete weekly occurrences live in the `instances`
 * subcollection and each carries its own InstanceStatus (see
 * SessionInstanceDoc). Parent 'confirmed' + an instance 'cancelled' = the series
 * is live but that one date is off. Instances exist ONLY once the series is
 * confirmed — a pending recurring request has recurringSlots but NO instances.
 */
export interface SessionDoc {
  sessionId: string;
  familyId: string;
  tutorUserId: string;
  createdByUserId: string;

  // Who initiated this session. Absent on legacy docs (all pre-feature bookings)
  // and treated as 'family' — a family-initiated request the tutor confirms. When
  // 'provider' this is a TUTOR-INITIATED proposal (V1.1 feature 3): the tutor
  // created it (createdByUserId === tutorUserId) and the FAMILY confirms/declines
  // it (picking students at accept). The proposer can never confirm their own doc.
  proposedBy?: ProposedBy;

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
  // one-time: end of the single occurrence. A recurring parent deliberately
  // OMITS this (its per-occurrence times live in recurringSlots), mirroring the
  // already-optional `date?` above.
  endTime?: string; // "HH:MM" (calculated from startTime + sessionLengthMinutes)
  sessionLengthMinutes: number;
  recurringSlots?: RecurringSlot[];
  schoolWeeksOnly?: boolean;
  // ── Trial first session (V1.1 feature 2; recurring only) ──
  // A booking-time family choice: flag the series' FIRST materialized occurrence
  // as a trial. DELIBERATE DEVIATION from the roadmap's `type: 'trial'` — a third
  // top-level type would ripple through every `type === 'one_time' | 'recurring'`
  // switch, so this is an additive boolean on the recurring parent instead. The
  // denormalized per-occurrence marker lives on SessionInstanceDoc.isTrial (set on
  // whichever instance actually materializes first at confirm). v1 is labeling
  // only — no pricing/cancellation mechanics attach (nothing to enforce without
  // payments). Omitted (not stored false) when the family does not opt in.
  trialFirstSession?: boolean;
  // Open-ended when absent: the series runs indefinitely (the extendRecurring
  // cron keeps a rolling 8-week horizon of instances). When present, no
  // occurrence is generated on or after truncation past this date.
  endDate?: string; // "YYYY-MM-DD" — last date the series may schedule

  // Where
  location: LocationPref;
  address?: string;
  latLng?: LatLng;

  // Optional free-text note from the family to the tutor, captured at book time.
  message?: string;

  // ── Session notes (V1.1 feature 1; set via the setSessionNote callable) ──
  // For a one_time session these live on this parent doc; for a recurring series
  // they live per-occurrence on SessionInstanceDoc instead.
  // FAMILY-authored, editable until the session's start time passes.
  preSessionNote?: string;
  // TUTOR-authored, writable once the session's start time has passed.
  postSessionNote?: string;

  // Padding (stored for override calculation)
  paddingMinutes: number;

  // ── Cancellation policy (V2 feature 7) ──
  // Snapshot of the tutor's profiles.tutor.cancellationNoticeHours taken when
  // the request was CREATED (bookSession / proposeSession). Late determination
  // always reads this snapshot; later profile edits are inert for this session.
  cancellationNoticeHours?: number;
  // Set true (one_time only) when the cancel happened inside the notice window
  // while the session was CONFIRMED. Recurring lateness lives per-instance.
  lateCancellation?: boolean;


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
