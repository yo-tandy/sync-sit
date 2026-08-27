import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The SITTER side of the cancel-time disclosure (issue #237, PR #248 round
 * 3): the flag is symmetric, so the babysitter dashboard's cancel dialog
 * shows the same "will be recorded" warning inside the window and stays
 * silent outside it. Twin of the family DashboardPage.lateWarn pins.
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
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { BabysitterDashboard } from '../DashboardPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <BabysitterDashboard />
    </MemoryRouter>,
  );
}

function confirmedApt(daysOut: number, noticeHours: number) {
  const d = new Date(Date.now() + daysOut * 24 * 60 * 60 * 1000);
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
    cancellationNoticeHours: noticeHours,
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
});

afterEach(cleanup);

async function openCancelDialog() {
  renderPage();
  const btn = await screen.findByText('Cancel Appointment');
  fireEvent.click(btn);
}

describe('babysitter cancel dialog late warning (issue #237)', () => {
  it('warns when the cancel is inside the notice window', async () => {
    h.appointments.confirmed = [confirmedApt(1, 48)];
    await openCancelDialog();
    await waitFor(() =>
      expect(screen.getByText(/will be recorded/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/48h/)).toBeInTheDocument();
  });

  it('does not warn outside the window', async () => {
    h.appointments.confirmed = [confirmedApt(14, 48)];
    await openCancelDialog();
    await waitFor(() => expect(screen.getAllByText(/reason/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/will be recorded/)).not.toBeInTheDocument();
  });
});
