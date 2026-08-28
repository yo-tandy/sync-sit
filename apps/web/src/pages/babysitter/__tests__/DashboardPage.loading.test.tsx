import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Loading skeletons on the babysitter dashboard's appointment list (UX F12,
 * issue #126): while appointments load the list area shows SkeletonCards —
 * not a centered spinner — and they disappear once data lands. Harness
 * mirrors DashboardPage.lateWarn.test.tsx.
 */
const h = vi.hoisted(() => ({
  appointments: {
    pending: [] as unknown[],
    confirmed: [] as unknown[],
    pastRecent: [] as unknown[],
    rejectedRecent: [] as unknown[],
    loading: false,
  },
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  limit: (n: number) => ({ limit: n }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: () => 'ts',
  onSnapshot: (_ref: unknown, cb: (snap: unknown) => void) => {
    cb({ docs: [], data: () => ({}) });
    return () => {};
  },
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
}));

const auth = {
  userDoc: {
    uid: 'bs-1',
    firstName: 'Lea',
    profiles: { babysitter: { ejemEmail: 'lea@ejm.org', searchable: true } },
  },
  firebaseUser: { uid: 'bs-1' },
  refreshUserDoc: vi.fn(),
};
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => auth }));
vi.mock('@/hooks/useAppointments', () => ({ useAppointments: () => h.appointments }));
vi.mock('@/hooks/useSchedule', () => ({
  useSchedule: () => ({ weekly: {}, overrides: [], loading: false }),
}));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => ({ periods: [], loading: false }) }));
vi.mock('@/components/published/PublishedSearchesPreview', () => ({
  PublishedSearchesPreview: () => null,
}));

import '@/i18n';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { BabysitterDashboard } from '../DashboardPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <BabysitterDashboard />
    </MemoryRouter>,
  );
}

function confirmedApt() {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return {
    appointmentId: 'apt-1',
    babysitterUserId: 'bs-1',
    familyId: 'fam1',
    familyName: 'Dupont',
    type: 'one_time',
    status: 'confirmed',
    date: d.toISOString().slice(0, 10),
    startTime: '18:00',
    endTime: '22:00',
    kidIds: [],
    address: 'x',
    latLng: { lat: 48.85, lng: 2.27 },
    filters: {},
  };
}

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    configurable: true,
  });
  h.appointments.pending = [];
  h.appointments.confirmed = [];
  h.appointments.pastRecent = [];
  h.appointments.rejectedRecent = [];
  h.appointments.loading = false;
});

afterEach(cleanup);

describe('babysitter dashboard loading skeletons (UX F12, issue #126)', () => {
  it('shows skeleton cards (no spinner) while appointments load', () => {
    h.appointments.loading = true;
    renderPage();
    expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('drops the skeletons once appointments land', async () => {
    h.appointments.confirmed = [confirmedApt()];
    renderPage();
    expect((await screen.findAllByText('Confirmed')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('skeleton-card')).toBeNull();
  });
});
