import { create } from 'zustand';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import type {
  AdminDashboardStats,
  FirestoreTimestamp,
  GdprExportData,
  HolidayPeriod,
} from '@ejm/sit-core';

interface AdminUserListItem {
  uid: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  status: string;
  searchable?: boolean;
  createdAt: FirestoreTimestamp | null;
}

/**
 * Admin-side view of an appointment, as returned by the `listAppointments`
 * callable. Shapes are wire-serialized — Firestore Timestamps may come
 * across as strings or {seconds,nanoseconds} objects depending on the
 * callable's serializer, so we model the unknown date fields opaquely.
 */
export interface AdminAppointmentListItem {
  id: string;
  babysitterUserId?: string;
  parentUserId?: string;
  familyId?: string;
  status: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  type?: string;
  offeredRate?: number;
  // Enriched server-side
  babysitterName?: string;
  familyName?: string;
  parentNames?: string;
}

/**
 * One row of the admin `listFamilies` callable: the family doc joined
 * server-side with parent summaries, kids, and supervision counts.
 */
export interface AdminFamilyParent {
  uid: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  status: string | null;
}

export interface AdminFamilyRow {
  familyId: string;
  familyName: string;
  address: string;
  status: string;
  createdAt: string | null;
  verified: boolean;
  parents: AdminFamilyParent[];
  kids: { firstName: string; age: number }[];
  kidsCount: number;
  governedKidsCount: number;
  preferredCount: number;
}

interface ListFamiliesPayload {
  searchQuery?: string;
  statusFilter?: string;
  verifiedFilter?: boolean;
  startAfterId?: string;
}

interface PreapprovedEmail {
  email: string;
  used: boolean;
  createdAt: FirestoreTimestamp | null;
}

/**
 * Enrollment exemption as returned by the `listEnrollmentExemptions`
 * callable: waives the DOB/grad-year consistency check for one EJM email
 * (never the under-15 floor). Doc id on the backend = the lowercased email.
 */
export interface EnrollmentExemption {
  email: string;
  note: string | null;
  createdByUid: string;
  createdAt: WireTimestamp | null;
}

/**
 * Wire shape for a timestamp coming back through a `httpsCallable` response.
 * The Firebase callable serializer may emit either an ISO string, an
 * Admin-SDK `_seconds`/`_nanoseconds` envelope, or a client-SDK
 * `seconds`/`nanoseconds` one.
 */
export type WireTimestamp =
  | string
  | { _seconds: number; _nanoseconds?: number }
  | { seconds: number; nanoseconds?: number };

/**
 * Admin-side audit log entry, as returned by the `listAuditLogs` callable.
 * Distinct from the Firestore-storage `AuditLogDoc` in @ejm/sit-core because
 * the wire shape carries an `id` field, enriched `adminInfo`/`targetInfo`,
 * and a serialized timestamp.
 */
export interface AdminAuditLogEntry {
  id: string;
  adminUserId: string;
  action: string;
  targetUserId?: string;
  details: Record<string, unknown>;
  timestamp: WireTimestamp;
  adminInfo: { email: string; name: string; role: string } | null;
  targetInfo: { email: string; name: string; role: string } | null;
}

// Dashboard stats include an extra pendingVerificationCount on top of the
// base shared type.
interface AdminStatsWithVerifications extends AdminDashboardStats {
  pendingVerificationCount: number;
}

/**
 * One row of the `listSupervisedAccounts` callable — a guardian link (any
 * status; revoked links stay auditable) joined with the child summary, the
 * family name, and the GDPR consent record.
 */
export interface SupervisedAccountRow {
  childUid: string;
  child: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    status: string | null;
    age: number | null;
    identityLocked: boolean;
  };
  familyId: string;
  familyName: string | null;
  link: {
    status: 'pending' | 'active' | 'revoked';
    origin: 'parent_created' | 'claim';
    createdByParentUid: string;
    requestedAt: string | null;
    confirmedAt: string | null;
    revokedAt: string | null;
    revokedByUid: string | null;
  };
  consent: {
    tosVersion: string | null;
    privacyVersion: string | null;
    supervisionAgreementVersion: string | null;
    approvedAt: string | null;
    approvedByUid: string | null;
  };
}

/** One governance alert of the `listAdminAlerts` callable. */
export interface GovernanceAlert {
  alertId: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string | null;
  reviewedAt: string | null;
  reviewedByUid: string | null;
}

interface AdminState {
  // Dashboard stats
  stats: AdminStatsWithVerifications | null;
  statsLoading: boolean;
  fetchStats: () => Promise<void>;

  // Users
  users: AdminUserListItem[];
  usersLoading: boolean;
  fetchUsers: (params: { search?: string; role?: string; status?: string }) => Promise<void>;
  blockUser: (uid: string) => Promise<void>;
  deactivateUser: (uid: string) => Promise<void>;
  deleteUser: (uid: string) => Promise<void>;
  resetUserPassword: (uid: string) => Promise<void>;

  // Families
  families: AdminFamilyRow[];
  familiesLoading: boolean;
  familiesHasMore: boolean;
  fetchFamilies: (params: {
    search?: string;
    status?: string;
    verified?: boolean;
    startAfterId?: string;
  }) => Promise<void>;

  // Appointments
  appointments: AdminAppointmentListItem[];
  appointmentsLoading: boolean;
  fetchAppointments: (params: { status?: string }) => Promise<void>;
  deleteAppointment: (id: string) => Promise<void>;

  // Holidays
  updateHolidays: (schoolYear: string, zone: string, periods: HolidayPeriod[]) => Promise<void>;

  // Audit logs
  auditLogs: AdminAuditLogEntry[];
  auditLogsLoading: boolean;
  fetchAuditLogs: (params: { action?: string }) => Promise<void>;

  // GDPR export
  exporting: boolean;
  exportUserData: (uid: string) => Promise<GdprExportData>;

  // Pre-approved emails
  preapprovedEmails: PreapprovedEmail[];
  preapprovedLoading: boolean;
  fetchPreapprovedEmails: () => Promise<void>;
  addPreapprovedEmail: (email: string) => Promise<void>;
  removePreapprovedEmail: (email: string) => Promise<void>;

  // Enrollment exemptions
  exemptions: EnrollmentExemption[];
  exemptionsLoading: boolean;
  fetchExemptions: () => Promise<void>;
  addExemption: (email: string, note?: string) => Promise<void>;
  removeExemption: (email: string) => Promise<void>;

  // Parental governance
  supervisedAccounts: SupervisedAccountRow[];
  supervisedLoading: boolean;
  fetchSupervisedAccounts: () => Promise<void>;
  governanceAlerts: GovernanceAlert[];
  governanceAlertsLoading: boolean;
  fetchGovernanceAlerts: (onlyUnreviewed: boolean) => Promise<void>;
  reviewGovernanceAlert: (alertId: string) => Promise<void>;
  forceRevokeSupervision: (childUid: string, reason: string) => Promise<void>;
}

export const useAdminStore = create<AdminState>((set) => ({
  // Dashboard stats
  stats: null,
  statsLoading: false,
  fetchStats: async () => {
    set({ statsLoading: true });
    try {
      const fn = httpsCallable<Record<string, never>, AdminStatsWithVerifications>(
        functions,
        'getAdminDashboard',
      );
      const result = await fn({});
      set({ stats: result.data, statsLoading: false });
    } catch (err) {
      set({ statsLoading: false });
      throw err;
    }
  },

  // Users
  users: [],
  usersLoading: false,
  fetchUsers: async (params) => {
    set({ usersLoading: true });
    try {
      const fn = httpsCallable<
        { searchQuery?: string; roleFilter?: string; statusFilter?: string },
        { users: AdminUserListItem[] }
      >(functions, 'listUsers');
      const result = await fn({
        searchQuery: params.search,
        roleFilter: params.role,
        statusFilter: params.status,
      });
      set({ users: result.data.users, usersLoading: false });
    } catch (err) {
      set({ usersLoading: false });
      throw err;
    }
  },
  blockUser: async (uid) => {
    const fn = httpsCallable(functions, 'blockUser');
    await fn({ targetUserId: uid });
  },
  deactivateUser: async (uid) => {
    const fn = httpsCallable(functions, 'deactivateUser');
    await fn({ targetUserId: uid });
  },
  deleteUser: async (uid) => {
    const fn = httpsCallable(functions, 'deleteUser');
    await fn({ targetUserId: uid });
  },
  resetUserPassword: async (uid) => {
    const fn = httpsCallable(functions, 'resetUserPassword');
    await fn({ targetUserId: uid });
  },

  // Families
  families: [],
  familiesLoading: false,
  familiesHasMore: false,
  fetchFamilies: async (params) => {
    // A cursor means "load more": append to the list instead of replacing it.
    const append = Boolean(params.startAfterId);
    if (!append) set({ familiesLoading: true });
    try {
      const fn = httpsCallable<
        ListFamiliesPayload,
        { families: AdminFamilyRow[]; hasMore: boolean }
      >(functions, 'listFamilies');
      // Omit empty fields entirely: the callable client serializes undefined
      // as null, which the backend's zod .optional() rejects.
      const payload: ListFamiliesPayload = {};
      if (params.search) payload.searchQuery = params.search;
      if (params.status) payload.statusFilter = params.status;
      if (params.verified !== undefined) payload.verifiedFilter = params.verified;
      if (params.startAfterId) payload.startAfterId = params.startAfterId;
      const result = await fn(payload);
      set((state) => ({
        families: append
          ? [...state.families, ...result.data.families]
          : result.data.families,
        familiesHasMore: result.data.hasMore,
        familiesLoading: false,
      }));
    } catch (err) {
      set({ familiesLoading: false });
      throw err;
    }
  },

  // Appointments
  appointments: [],
  appointmentsLoading: false,
  fetchAppointments: async (params) => {
    set({ appointmentsLoading: true });
    try {
      const fn = httpsCallable<
        { statusFilter?: string },
        { appointments: AdminAppointmentListItem[] }
      >(functions, 'listAppointments');
      const result = await fn({ statusFilter: params.status });
      set({ appointments: result.data.appointments, appointmentsLoading: false });
    } catch (err) {
      set({ appointmentsLoading: false });
      throw err;
    }
  },
  deleteAppointment: async (id) => {
    const fn = httpsCallable(functions, 'deleteAppointment');
    await fn({ appointmentId: id });
  },

  // Holidays
  updateHolidays: async (schoolYear, zone, periods) => {
    const fn = httpsCallable(functions, 'updateHolidays');
    await fn({ schoolYear, zone, periods });
  },

  // Audit logs
  auditLogs: [],
  auditLogsLoading: false,
  fetchAuditLogs: async (params) => {
    set({ auditLogsLoading: true });
    try {
      const fn = httpsCallable<
        { actionFilter?: string },
        { logs: AdminAuditLogEntry[] }
      >(functions, 'listAuditLogs');
      const result = await fn({ actionFilter: params.action });
      set({ auditLogs: result.data.logs, auditLogsLoading: false });
    } catch (err) {
      set({ auditLogsLoading: false });
      throw err;
    }
  },

  // GDPR export
  exporting: false,
  exportUserData: async (uid) => {
    set({ exporting: true });
    try {
      const fn = httpsCallable<{ targetUserId: string }, GdprExportData>(
        functions,
        'exportUserData',
      );
      const result = await fn({ targetUserId: uid });
      set({ exporting: false });
      return result.data;
    } catch (err) {
      set({ exporting: false });
      throw err;
    }
  },
  // Pre-approved emails
  preapprovedEmails: [],
  preapprovedLoading: false,
  fetchPreapprovedEmails: async () => {
    set({ preapprovedLoading: true });
    try {
      const fn = httpsCallable<
        Record<string, never>,
        { emails: PreapprovedEmail[] }
      >(functions, 'listPreapprovedEmails');
      const result = await fn({});
      set({ preapprovedEmails: result.data.emails, preapprovedLoading: false });
    } catch (err) {
      set({ preapprovedLoading: false });
      throw err;
    }
  },
  addPreapprovedEmail: async (email) => {
    const fn = httpsCallable(functions, 'addPreapprovedEmail');
    await fn({ email });
  },
  removePreapprovedEmail: async (email) => {
    const fn = httpsCallable(functions, 'removePreapprovedEmail');
    await fn({ email });
  },

  // Enrollment exemptions
  exemptions: [],
  exemptionsLoading: false,
  fetchExemptions: async () => {
    set({ exemptionsLoading: true });
    try {
      const fn = httpsCallable<
        Record<string, never>,
        { exemptions: EnrollmentExemption[] }
      >(functions, 'listEnrollmentExemptions');
      const result = await fn({});
      set({ exemptions: result.data.exemptions, exemptionsLoading: false });
    } catch (err) {
      set({ exemptionsLoading: false });
      throw err;
    }
  },
  addExemption: async (email, note) => {
    const fn = httpsCallable(functions, 'setEnrollmentExemption');
    // Omit `note` entirely when empty: the callable client serializes
    // undefined as null, which the backend's zod .optional() rejects.
    await fn(note ? { email, note } : { email });
  },
  removeExemption: async (email) => {
    const fn = httpsCallable(functions, 'removeEnrollmentExemption');
    await fn({ email });
  },

  // Parental governance
  supervisedAccounts: [],
  supervisedLoading: false,
  fetchSupervisedAccounts: async () => {
    set({ supervisedLoading: true });
    try {
      const fn = httpsCallable<Record<string, never>, { accounts: SupervisedAccountRow[] }>(
        functions,
        'listSupervisedAccounts',
      );
      const result = await fn({});
      set({ supervisedAccounts: result.data.accounts, supervisedLoading: false });
    } catch (err) {
      set({ supervisedLoading: false });
      throw err;
    }
  },
  governanceAlerts: [],
  governanceAlertsLoading: false,
  fetchGovernanceAlerts: async (onlyUnreviewed) => {
    set({ governanceAlertsLoading: true });
    try {
      const fn = httpsCallable<{ onlyUnreviewed: boolean }, { alerts: GovernanceAlert[] }>(
        functions,
        'listAdminAlerts',
      );
      const result = await fn({ onlyUnreviewed });
      set({ governanceAlerts: result.data.alerts, governanceAlertsLoading: false });
    } catch (err) {
      set({ governanceAlertsLoading: false });
      throw err;
    }
  },
  reviewGovernanceAlert: async (alertId) => {
    const fn = httpsCallable(functions, 'reviewAdminAlert');
    await fn({ alertId });
  },
  forceRevokeSupervision: async (childUid, reason) => {
    const fn = httpsCallable(functions, 'forceRevokeSupervision');
    await fn({ childUid, reason });
  },
}));
