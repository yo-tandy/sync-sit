import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

/**
 * The late-cancellation record on the sitter's request detail page (issue
 * #237 read surface): a cancelled appointment flagged `lateCancellation`
 * renders the amber record badge; an ordinary cancellation does not.
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
}));

vi.mock('@/config/firebase', () => ({ db: {}, auth: {}, functions: {}, storage: {} }));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => ({ periods: [] }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));
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
    status: 'cancelled',
    statusReason: 'cancelled_by_family',
    cancelledFromStatus: 'confirmed',
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

beforeEach(() => {
  h.auth.userDoc = {
    uid: 'bs-1',
    profiles: { babysitter: { ejemEmail: 'b@ejm.org' } },
  };
});

afterEach(cleanup);

describe('RequestDetailPage late-cancellation record (issue #237)', () => {
  it('renders the amber record badge for a late-flagged cancellation', async () => {
    h.aptData = apt({ lateCancellation: true });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('appointment.cancelledLateBadge')).toBeInTheDocument(),
    );
  });

  it('renders NO record badge for an ordinary cancellation', async () => {
    h.aptData = apt();
    renderPage();
    // The echo-t drops interpolation params, so anchor on the status badge.
    await waitFor(() => expect(screen.getByText('request.declined')).toBeInTheDocument());
    expect(screen.queryByText('appointment.cancelledLateBadge')).not.toBeInTheDocument();
  });
});
