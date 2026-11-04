import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Cancel-failure copy on the babysitter dashboard: a FunctionsError is an
 * Error, so the old `err instanceof Error ? err.message` echoed the bare
 * `internal` token / English server text. Only failed-precondition (the
 * appointment is no longer confirmed/pending) is mapped to specific copy.
 */
const h = vi.hoisted(() => ({
  callable: vi.fn<(p: unknown) => Promise<unknown>>(),
  appointments: {
    pending: [] as unknown[],
    confirmed: [] as unknown[],
    pastRecent: [] as unknown[],
    rejectedRecent: [] as unknown[],
    loading: false,
  },
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => h.callable }));
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

import i18n from '@/i18n';
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function submitCancel() {
  h.appointments.confirmed = [confirmedApt(14, 0)];
  renderPage();
  fireEvent.click(await screen.findByText('Cancel Appointment'));
  fireEvent.change(await screen.findByPlaceholderText(i18n.t('appointment.cancelReasonPlaceholder')), {
    target: { value: 'Sick' },
  });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('appointment.confirmCancel') }));
}

function fnError(code: string, message: string) {
  return Object.assign(new Error(message), { code: `functions/${code}` });
}

describe('babysitter dashboard cancel failure copy', () => {
  it('an unexpected fault alerts the translated generic copy, never the raw token', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    h.callable.mockRejectedValueOnce(fnError('internal', 'internal'));
    await submitCancel();

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(i18n.t('common.error'));
    expect(alertSpy).not.toHaveBeenCalledWith('internal');
  });

  it('failed-precondition maps to the translated "can no longer be cancelled" copy', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    h.callable.mockRejectedValueOnce(
      fnError('failed-precondition', 'Only confirmed or pending appointments can be cancelled'),
    );
    await submitCancel();

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(i18n.t('request.cancelUnavailable'));
  });
});
