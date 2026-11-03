import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

/**
 * Callable-failure copy on the sitter's request detail page. A FunctionsError
 * IS an Error, so `err instanceof Error ? err.message : fallback` echoed the
 * bare `internal` token / English server text. The echo-`t` below returns the
 * key, so the assertions pin WHICH translated key is alerted. Only
 * failed-precondition is mapped to specific copy (cancel: appointment no
 * longer confirmed/pending; respond: "no longer pending").
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

const h = vi.hoisted(() => ({
  aptData: {} as Record<string, unknown>,
  auth: { userDoc: null as unknown },
  callable: vi.fn<(p: unknown) => Promise<unknown>>(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, auth: {}, functions: {}, storage: {} }));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => ({ periods: [] }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));
// getParentContacts fires on mount for non-pending appointments; keep it from
// consuming the rejection queued for the callable under test.
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) =>
    name === 'getParentContacts' ? () => Promise.resolve({ data: { contacts: [] } }) : h.callable,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [], empty: true }),
  onSnapshot: (_ref: unknown, next: (snap: unknown) => void) => {
    next({ exists: () => true, data: () => h.aptData, id: 'apt-1' });
    return vi.fn();
  },
}));

import { RequestDetailPage } from '../RequestDetailPage';

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/babysitter/requests/:appointmentId', element: <RequestDetailPage /> }],
    { initialEntries: ['/babysitter/requests/apt-1'] },
  );
  return render(<RouterProvider router={router} />);
}

function apt(overrides: Record<string, unknown> = {}) {
  return {
    appointmentId: 'apt-1',
    babysitterUserId: 'bs-1',
    familyId: 'fam-1',
    familyName: 'Dupont',
    type: 'one_time',
    status: 'pending',
    date: '2026-07-01',
    startTime: '18:00',
    endTime: '22:00',
    kidIds: [],
    address: '15 Rue de Passy',
    latLng: { lat: 48.85, lng: 2.27 },
    filters: {},
    ...overrides,
  };
}

function fnError(code: string, message: string) {
  return Object.assign(new Error(message), { code: `functions/${code}` });
}

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.callable.mockReset();
  h.auth.userDoc = { uid: 'bs-1', profiles: { babysitter: { ejemEmail: 'b@ejm.org' } } };
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RequestDetailPage callable failure copy', () => {
  it('acknowledge: an unexpected fault alerts generic copy, never the raw token', async () => {
    h.aptData = apt({ status: 'confirmed', modified: true });
    h.callable.mockRejectedValueOnce(fnError('internal', 'internal'));
    renderPage();
    fireEvent.click(await screen.findByText('appointment.acknowledgeChanges'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith('common.error');
    expect(alertSpy).not.toHaveBeenCalledWith('internal');
  });

  it('withdraw: an unexpected fault alerts generic copy, never the raw token', async () => {
    h.aptData = apt({ initiatedBy: 'babysitter' });
    h.callable.mockRejectedValueOnce(fnError('internal', 'internal'));
    renderPage();
    fireEvent.click(await screen.findByText('request.withdraw'));
    const buttons = await screen.findAllByText('request.withdraw');
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith('common.error');
    expect(alertSpy).not.toHaveBeenCalledWith('internal');
  });

  it('withdraw: failed-precondition maps to the "can no longer be cancelled" key', async () => {
    h.aptData = apt({ initiatedBy: 'babysitter' });
    h.callable.mockRejectedValueOnce(
      fnError('failed-precondition', 'Only confirmed or pending appointments can be cancelled'),
    );
    renderPage();
    fireEvent.click(await screen.findByText('request.withdraw'));
    const buttons = await screen.findAllByText('request.withdraw');
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith('request.cancelUnavailable');
  });

  it('respond: an unexpected fault alerts generic copy, never the raw token', async () => {
    h.aptData = apt();
    h.callable.mockRejectedValueOnce(fnError('internal', 'internal'));
    renderPage();
    fireEvent.click(await screen.findByText('request.decline'));
    fireEvent.click(await screen.findByText('request.confirmDecline'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith('common.error');
    expect(alertSpy).not.toHaveBeenCalledWith('internal');
  });

  it('respond: failed-precondition maps to the "no longer pending" key', async () => {
    h.aptData = apt();
    h.callable.mockRejectedValueOnce(
      fnError('failed-precondition', 'This appointment is no longer pending'),
    );
    renderPage();
    fireEvent.click(await screen.findByText('request.decline'));
    fireEvent.click(await screen.findByText('request.confirmDecline'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith('request.noLongerPending');
  });
});
