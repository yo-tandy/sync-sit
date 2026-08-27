import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Cancel-time disclosure (issue #237, PR #248 round 2): opening the cancel
 * dialog for a confirmed appointment INSIDE the sitter's notice window shows
 * the "will be recorded" warning before submit; outside the window it does
 * not. Client-side approximation — the server flag stays authoritative.
 *
 * Moved from DashboardPage with the dialog itself (issue #241): the family's
 * appointment lists and their dialogs now live on /family/appointments.
 */
const h = vi.hoisted(() => ({
  appointments: {
    pending: [] as unknown[],
    confirmed: [] as unknown[],
    pastRecent: [] as unknown[],
    rejectedRecent: [] as unknown[],
    loading: false,
  },
  // Per-callable overrides; anything unlisted resolves undefined.
  callables: {} as Record<string, (payload: unknown) => Promise<unknown>>,
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) =>
    (h.callables[name] ?? (() => Promise.resolve(undefined)))(payload),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  limit: (n: number) => ({ limit: n }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  onSnapshot: (_ref: unknown, cb: (snap: unknown) => void) => {
    cb({ docs: [], data: () => ({}) });
    return () => {};
  },
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  addDoc: vi.fn(),
}));

const auth = { userDoc: { uid: 'p1', profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } } } };
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => auth }));
vi.mock('@/stores/verificationStore', () => ({
  useVerificationStore: () => ({ familyVerification: null, fetchStatus: vi.fn() }),
}));
vi.mock('@/hooks/useFamilyAppointments', () => ({
  useFamilyAppointments: () => h.appointments,
}));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => ({ periods: [], loading: false }) }));

import '@/i18n';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FamilyAppointmentsPage } from '../AppointmentsPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <FamilyAppointmentsPage />
    </MemoryRouter>,
  );
}

function confirmedApt(daysOut: number, noticeHours: number) {
  const d = new Date(Date.now() + daysOut * 24 * 60 * 60 * 1000);
  return {
    appointmentId: 'apt-1',
    babysitterUserId: 'bs-1',
    familyId: 'fam1',
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
  // Expand the confirmed card, then open its cancel dialog.
  const expand = await screen.findByText(/babysitting/i, { exact: false }).catch(() => null);
  void expand;
  const buttons = screen.getAllByRole('button');
  // Cards are collapsed; the card header toggle is a button. Click each
  // toggle until the Cancel action appears (single card here).
  for (const b of buttons) {
    fireEvent.click(b);
    if (screen.queryByText('Cancel Appointment')) break;
  }
  fireEvent.click(screen.getByText('Cancel Appointment'));
}

describe('family cancel dialog late warning (issue #237)', () => {
  it('warns when the cancel is inside the notice window', async () => {
    h.appointments.confirmed = [confirmedApt(1, 48)]; // tomorrow, 48h window
    await openCancelDialog();
    await waitFor(() =>
      expect(screen.getByText(/will be recorded/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/48h/)).toBeInTheDocument();
  });

  it('does not warn outside the window', async () => {
    h.appointments.confirmed = [confirmedApt(14, 48)]; // two weeks out
    await openCancelDialog();
    await waitFor(() => expect(screen.getAllByText(/reason/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/will be recorded/)).not.toBeInTheDocument();
  });

  it('an inside_notice_window modify refusal surfaces the policy copy, not the raw code', async () => {
    // The other half of #237's family-side surface. This mapping existed on
    // DashboardPage, was dropped in the move to this page, and nothing
    // pinned it — so a parent briefly got a raw "inside_notice_window" alert
    // (PR #256 review). Mock the callable refusal, drive the edit dialog,
    // and assert the localized line is what reaches the alert.
    h.appointments.confirmed = [confirmedApt(1, 48)];
    h.callables.modifyAppointment = () =>
      Promise.reject(new Error('inside_notice_window'));
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    renderPage();
    // Let effects settle before poking at the card (same reason
    // openCancelDialog awaits first), then expand it and open Edit.
    await screen.findAllByRole('button');
    for (const b of screen.getAllByRole('button')) {
      fireEvent.click(b);
      if (screen.queryByText('Edit')) break;
    }
    fireEvent.click(await screen.findByText('Edit'));
    fireEvent.click(await screen.findByText('Save Changes'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const alerted = String(alertSpy.mock.calls[0][0]);
    expect(alerted).toMatch(/notice window/i);
    expect(alerted).not.toBe('inside_notice_window');
    alertSpy.mockRestore();
    delete h.callables.modifyAppointment;
  });
});
