import type { FirestoreTimestamp, LatLng } from './common.js';
import type {
  AppointmentStatus,
  AppointmentStatusReason,
  SearchType,
  SearchStatus,
} from '../constants/index.js';
import type { RecurringSlot } from '@ejm/shared-core';

// Re-export RecurringSlot (and the rest of shared-core's surface) so consumers
// importing from '@ejm/shared' still see it.
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
  searchId: string;
  familyId: string;
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
  address: string;
  latLng: LatLng;
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
}
