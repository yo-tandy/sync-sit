import type { FirestoreTimestamp, LatLng } from './common.js';
import type {
  AppointmentStatus,
  AppointmentStatusReason,
  SearchType,
  SearchStatus,
} from '../constants/index.js';
import type { RecurringSlot } from '@ejm/shared-core';

// Re-export RecurringSlot (and the rest of shared-core's surface) so consumers
// importing from '@ejm/sit-core' still see it.
export * from '@ejm/shared-core';

export interface SearchDoc {
  searchId: string;
  familyId: string;
  createdByUserId: string;
  type: SearchType;
  status: SearchStatus;

  // One-time
  date?: string; // "YYYY-MM-DD"
  startTime?: string;
  endTime?: string;

  // Recurring
  recurringSlots?: RecurringSlot[];
  schoolWeeksOnly?: boolean;

  // Common
  kidIds: string[];
  address: string;
  latLng: LatLng;
  offeredRate?: number;
  additionalInfo?: string;
  filters: {
    minAge?: number;
    gender?: string;
    requireReferences?: boolean;
  };

  createdAt: FirestoreTimestamp;
}

export interface AppointmentDoc {
  appointmentId: string;
  /** null for babysitter-initiated docs: the published search IS the search. */
  searchId: string | null;
  familyId: string;
  /**
   * Who started this appointment (issue #207 PR3). Absent on every doc minted
   * before the contact inversion shipped, and on family-initiated docs since —
   * absent MEANS 'family'. Only 'babysitter' flips the respond roles.
   */
  initiatedBy?: 'family' | 'babysitter';
  /** Set iff initiatedBy === 'babysitter': the search that was answered. */
  publishedSearchId?: string | null;
  babysitterUserId: string;
  createdByUserId: string;
  type: SearchType;
  status: AppointmentStatus;
  statusReason?: AppointmentStatusReason;
  cancellationReason?: string;
  cancelledFromStatus?: string;

  // Copied from search at creation
  date?: string;
  startTime?: string;
  endTime?: string;
  recurringSlots?: RecurringSlot[];
  schoolWeeksOnly?: boolean;
  kidIds: string[];
  /**
   * WITHHELD (null) on a pending babysitter-initiated appointment and filled
   * in by respondToRequest's family-accept branch — disclosure follows the
   * family's consent (issue #207 PR3).
   */
  address: string | null;
  latLng: LatLng | null;
  offeredRate?: number;
  message?: string;
  additionalInfo?: string;

  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  confirmedAt?: FirestoreTimestamp;
  cancelledAt?: FirestoreTimestamp;
  softDeletedAt?: FirestoreTimestamp;

  // Modification tracking
  modified?: boolean;
  modifiedAt?: FirestoreTimestamp;
  modifiedFields?: string[];

  // Resubmission tracking
  isResubmission?: boolean;
  resubmittedFromAppointmentId?: string;

  // Appointment notes (issue #238, parity B2 — adopted from study's session
  // notes). Readable by the appointment's own read rule (family parents +
  // babysitter + admin) AND, for a supervised babysitter, by their guardians
  // via the getGovernedChildDetail projection (ruling 8 — same as study's
  // session notes). Written via setAppointmentNote only (rules stay
  // deny-all).
  /** FAMILY-authored logistics note (door codes, bedtime, allergies). */
  preAppointmentNote?: string;
  /** BABYSITTER-authored debrief note (how the sitting went). */
  postAppointmentNote?: string;
}
