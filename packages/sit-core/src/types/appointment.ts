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
  // Notice-window snapshot taken at creation + the allow-but-flag cancel
  // marker (issue #237; study's session contract mirrored).
  cancellationNoticeHours?: number;
  lateCancellation?: boolean;
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
}
