import { create } from 'zustand';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

interface AdminUserListItem {
  uid: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  status: string;
  searchable?: boolean;
  createdAt: any;
}

interface AdminStats {
  babysitterCount: number;
  familyCount: number;
  appointmentCount: number;
}

interface AdminState {
  // Dashboard stats
  stats: AdminStats | null;
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

  // Appointments
  appointments: any[];
  appointmentsLoading: boolean;
  fetchAppointments: (params: { status?: string }) => Promise<void>;
  deleteAppointment: (id: string) => Promise<void>;

  // Holidays
  updateHolidays: (schoolYear: string, zone: string, periods: any[]) => Promise<void>;

  // Audit logs
  auditLogs: any[];
  auditLogsLoading: boolean;
  fetchAuditLogs: (params: { action?: string }) => Promise<void>;

  // GDPR export
  exporting: boolean;
  exportUserData: (uid: string) => Promise<any>;
}

export const useAdminStore = create<AdminState>((set) => ({
  // Dashboard stats
  stats: null,
  statsLoading: false,
  fetchStats: async () => {
    set({ statsLoading: true });
    try {
      const fn = httpsCallable(functions, 'getAdminDashboard');
      const result = await fn({});
      set({ stats: result.data as AdminStats, statsLoading: false });
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
      const fn = httpsCallable(functions, 'listUsers');
      const result = await fn({
        searchQuery: params.search,
        roleFilter: params.role,
        statusFilter: params.status,
      });
      set({ users: (result.data as any).users as AdminUserListItem[], usersLoading: false });
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

  // Appointments
  appointments: [],
  appointmentsLoading: false,
  fetchAppointments: async (params) => {
    set({ appointmentsLoading: true });
    try {
      const fn = httpsCallable(functions, 'listAppointments');
      const result = await fn({ statusFilter: params.status });
      set({ appointments: (result.data as any).appointments, appointmentsLoading: false });
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
      const fn = httpsCallable(functions, 'listAuditLogs');
      const result = await fn({ actionFilter: params.action });
      set({ auditLogs: (result.data as any).logs, auditLogsLoading: false });
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
      const fn = httpsCallable(functions, 'exportUserData');
      const result = await fn({ targetUserId: uid });
      set({ exporting: false });
      return result.data;
    } catch (err) {
      set({ exporting: false });
      throw err;
    }
  },
}));
