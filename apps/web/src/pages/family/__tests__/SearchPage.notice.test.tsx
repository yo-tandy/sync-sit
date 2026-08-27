import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';

/**
 * Cancellation-notice line on the search result card (issue #237) — the sit
 * twin of study-web's TutorCard notice tests: a positive window renders the
 * humanized "Asks for {window} cancellation notice" line, 168 renders the
 * translated week label, and 0 (no policy) renders nothing.
 */
const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_DATE = new Date(NOW + 3 * DAY_MS).toISOString().split('T')[0];

const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  callable: vi.fn(),
  unsub: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (target: unknown) => target,
  where: (...args: unknown[]) => ({ where: args }),
  limit: (n: number) => ({ limit: n }),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
  onSnapshot: () => h.unsub,
  deleteDoc: () => Promise.resolve(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

vi.mock('@/hooks/useHolidays', () => ({
  useHolidays: () => ({ periods: [], loading: false }),
}));

import '@/i18n';
import { SearchPage } from '../SearchPage';

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

function sitter(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'sit1',
    firstName: 'Lea',
    lastName: 'M',
    age: 17,
    classLevel: 'Premiere',
    languages: ['fr'],
    maxKids: 2,
    distance: 1.2,
    referenceCount: 0,
    isPreferred: false,
    cancellationNoticeHours: 0,
    ...overrides,
  };
}

async function searchToResults(results: unknown[]) {
  h.callable.mockResolvedValue({ data: { results } });
  renderPage();
  fireEvent.click(screen.getByText('One-time'));
  await waitFor(() => expect(screen.getByLabelText('Date *')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Date *'), { target: { value: FUTURE_DATE } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(h.callable).toHaveBeenCalledWith('searchBabysitters', expect.anything()));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.userDoc = {
    uid: 'p1',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
  };
  h.getDoc.mockResolvedValue({
    exists: () => true,
    data: () => ({
      familyId: 'fam1',
      familyName: 'Dupont',
      address: '15 Rue de Passy, 75016 Paris',
      latLng: { lat: 48.85, lng: 2.27 },
      verification: { isFullyVerified: true },
      preferredBabysitters: [],
    }),
  });
  h.getDocs.mockImplementation((target: { path?: string }) =>
    Promise.resolve(
      target?.path?.endsWith('/kids')
        ? { docs: [{ id: 'kid1', data: () => ({ firstName: 'Lucas', age: 6, languages: ['fr'] }) }] }
        : { docs: [] },
    ),
  );
});

afterEach(cleanup);

describe('SearchPage result card — cancellation notice line (issue #237)', () => {
  it('renders the humanized notice line for an hour window', async () => {
    await searchToResults([sitter({ cancellationNoticeHours: 48 })]);
    await waitFor(() =>
      expect(screen.getByText('Asks for 48h cancellation notice')).toBeInTheDocument(),
    );
  });

  it('renders the translated week label for the 168 preset', async () => {
    await searchToResults([sitter({ cancellationNoticeHours: 168 })]);
    await waitFor(() =>
      expect(screen.getByText('Asks for 1 week cancellation notice')).toBeInTheDocument(),
    );
  });

  it('renders no notice line when the sitter has no policy (0)', async () => {
    await searchToResults([sitter({ cancellationNoticeHours: 0 })]);
    await waitFor(() => expect(screen.getAllByText(/Lea/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/cancellation notice/)).not.toBeInTheDocument();
  });
});
