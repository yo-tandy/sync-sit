import type { FirestoreTimestamp } from './common.js';

export interface InviteLinkDoc {
  token: string;
  familyId: string;
  createdByUserId: string;
  expiresAt: FirestoreTimestamp;
  used: boolean;
  usedByUserId?: string;
  createdAt: FirestoreTimestamp;
}

export interface HolidayPeriod {
  name: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
}

export interface HolidayDoc {
  schoolYear: string; // "2026-2027"
  zone: string; // "C"
  periods: HolidayPeriod[];
  updatedAt: FirestoreTimestamp;
  updatedByUserId: string;
}

export interface AuditLogDoc {
  logId: string;
  adminUserId: string;
  action: string;
  targetUserId?: string;
  details: Record<string, unknown>;
  timestamp: FirestoreTimestamp;
}
