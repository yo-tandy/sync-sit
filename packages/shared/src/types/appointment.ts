import type { FirestoreTimestamp, LatLng } from './common.js';
import type {
  AppointmentStatus,
  AppointmentStatusReason,
  SearchType,
  SearchStatus,
  DayOfWeek,
} from '../constants/index.js';

export interface RecurringSlot {
  day: DayOfWeek;
  startTime: string; // "HH:MM"
  endTime: string;
}

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
}
