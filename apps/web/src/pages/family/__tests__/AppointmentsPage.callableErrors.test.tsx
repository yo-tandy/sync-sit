import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Callable-error copy on the family appointments page: respond / cancel /
 * modify / resubmit must never alert the raw FunctionsError message (a bare
 * `internal`, or English-only server text). Unexpected faults show the
 * translated generic copy; the state conflicts the server throws
 * deliberately map to their own keys.
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
  callables: {
    getBabysitterSummaries: () => Promise.resolve({ data: { summaries: [] } }),} as Record<string, (payload: unknown) => Promise<unknown>>,
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

import i18n from '@/i18n';
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


const fnError = (code: string, message: string) =>
  Object.assign(new Error(message), { code: `functions/${code}` });

function apt(status: string, extra: Record<string, unknown> = {}) {
  return {
    appointmentId: 'apt-1',
    babysitterUserId: 'bs-1',
    familyId: 'fam1',
    type: 'one_time',
    status,
    date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    startTime: '18:00',
    endTime: '22:00',
    kidIds: [],
    address: 'x',
    latLng: { lat: 48.85, lng: 2.27 },
    filters: {},
    ...extra,
  };
}

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  i18n.changeLanguage('en');
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
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  alertSpy.mockRestore();
  for (const k of ['respondToRequest', 'cancelAppointment', 'modifyAppointment', 'resubmitAppointment']) {
    delete h.callables[k];
  }
});

/** Expand the (single) card until `label` shows, then click it. */
async function clickCardAction(label: string) {
  renderPage();
  await screen.findAllByRole('button');
  for (const b of screen.getAllByRole('button')) {
    fireEvent.click(b);
    if (screen.queryByText(label)) break;
  }
  fireEvent.click(await screen.findByText(label));
}

async function alerted(): Promise<string> {
  await waitFor(() => expect(alertSpy).toHaveBeenCalled());
  return String(alertSpy.mock.calls[0][0]);
}

async function drive(action: 'respond' | 'cancel' | 'modify' | 'resubmit') {
  if (action === 'respond') {
    h.appointments.pending = [apt('pending', { initiatedBy: 'babysitter' })];
    await clickCardAction(i18n.t('request.accept'));
    // The confirm dialog has its own Accept button (last in DOM order).
    const accepts = await screen.findAllByRole('button', { name: i18n.t('request.accept') });
    fireEvent.click(accepts[accepts.length - 1]);
  } else if (action === 'cancel') {
    h.appointments.confirmed = [apt('confirmed')];
    await clickCardAction(i18n.t('appointment.cancelTitle'));
    fireEvent.change(await screen.findByLabelText(/Reason for cancellation/), { target: { value: 'sick' } });
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('appointment.confirmCancel') }));
  } else if (action === 'modify') {
    h.appointments.confirmed = [apt('confirmed')];
    await clickCardAction('Edit');
    fireEvent.click(await screen.findByText(i18n.t('appointment.saveChanges')));
  } else {
    h.appointments.rejectedRecent = [apt('rejected')];
    await clickCardAction(i18n.t('appointment.resubmit'));
    fireEvent.change(await screen.findByLabelText(/Additional notes/i), { target: { value: 'please' } });
    const btns = await screen.findAllByRole('button', { name: i18n.t('appointment.resubmit') });
    fireEvent.click(btns[btns.length - 1]);
  }
}

const CALLABLE = {
  respond: 'respondToRequest',
  cancel: 'cancelAppointment',
  modify: 'modifyAppointment',
  resubmit: 'resubmitAppointment',
} as const;

describe('family AppointmentsPage callable errors never echo the raw message', () => {
  for (const action of ['respond', 'cancel', 'modify', 'resubmit'] as const) {
    it(`${action}: an unexpected server fault shows the translated generic copy, not "internal"`, async () => {
      h.callables[CALLABLE[action]] = () => Promise.reject(fnError('internal', 'internal'));
      await drive(action);
      const msg = await alerted();
      expect(msg).toBe(i18n.t('common.error'));
      expect(msg).not.toContain('internal');
    });
  }

  const specific = [
    ['respond', 'appointment.respondErrorNotPending', 'This appointment is no longer pending'],
    ['cancel', 'appointment.cancelErrorState', 'Only confirmed or pending appointments can be cancelled'],
    ['modify', 'appointment.modifyErrorState', 'Only pending or confirmed appointments can be modified'],
    ['resubmit', 'appointment.resubmitErrorState', 'Only declined requests can be resubmitted'],
  ] as const;
  for (const [action, key, serverMsg] of specific) {
    it(`${action}: failed-precondition maps to ${key}, not the English server text`, async () => {
      h.callables[CALLABLE[action]] = () => Promise.reject(fnError('failed-precondition', serverMsg));
      await drive(action);
      const msg = await alerted();
      expect(msg).toBe(i18n.t(key));
      expect(msg).not.toBe(serverMsg);
    });
  }

  it('modify: the inside_notice_window refusal (a failed-precondition) still gets the policy copy', async () => {
    h.callables.modifyAppointment = () =>
      Promise.reject(fnError('failed-precondition', 'inside_notice_window'));
    await drive('modify');
    expect(await alerted()).toBe(i18n.t('appointment.modifyInsideWindow'));
  });
});
