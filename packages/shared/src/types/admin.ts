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

export const AuditAction = {
  BLOCK_USER: 'block_user',
  UNBLOCK_USER: 'unblock_user',
  DELETE_USER: 'delete_user',
  RESET_PASSWORD: 'reset_password',
  EXPORT_USER_DATA: 'export_user_data',
  DELETE_APPOINTMENT: 'delete_appointment',
  UPDATE_HOLIDAYS: 'update_holidays',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditLogDoc {
  logId: string;
  adminUserId: string;
  action: AuditAction | string;
  targetUserId?: string;
  details: Record<string, unknown>;
  timestamp: FirestoreTimestamp;
}

export interface AdminDashboardStats {
  babysitterCount: number;
  familyCount: number;
  appointmentCount: number;
}

export interface AdminUserListItem {
  uid: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  status: string;
  createdAt: FirestoreTimestamp | null;
}

export interface GdprExportData {
  profile: Record<string, unknown>;
  family?: Record<string, unknown>;
  appointments: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  auditLogs: Record<string, unknown>[];
  exportedAt: string;
  exportedByAdminId: string;
}
