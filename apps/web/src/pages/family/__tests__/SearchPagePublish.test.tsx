import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';

/**
 * Published-searches surface on the family SearchPage (issue #207): the
 * publish CTA on the results step + confirm dialog (publishSearch callable
 * with the CURRENT form values incl. kidIds), the cap error, and the
 * own-active list with client-side expiry filtering and withdraw (rules-gated
 * client deleteDoc).
 */

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_DATE = new Date(NOW + 3 * DAY_MS).toISOString().split('T')[0];

const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  callable: vi.fn(),
  snapshotNext: null as ((snap: unknown) => void) | null,
  deleteDoc: vi.fn<(ref: { path: string }) => Promise<void>>(() => Promise.resolve()),
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
  onSnapshot: (_q: unknown, next: (snap: unknown) => void) => {
    h.snapshotNext = next;
    return h.unsub;
  },
  deleteDoc: (...args: [ref: { path: string }]) => h.deleteDoc(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

// The holidays hook reads Firestore on its own — inert here.
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

/** Fake published-search snapshot doc. */
function pubDoc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      id,
      app: 'sit',
      familyId: 'fam1',
      type: 'one_time',
      date: FUTURE_DATE,
      startTime: '18:00',
      endTime: '22:00',
      recurringSlots: null,
      kidAges: [6],
      createdAt: { toMillis: () => NOW - 1000 },
      expiresAt: { toMillis: () => NOW + DAY_MS, toDate: () => new Date(NOW + DAY_MS) },
      ...overrides,
    }),
  };
}

/** Drive the wizard to the results step (one_time, future date, kid selected). */
async function searchToResults() {
  renderPage();
  fireEvent.click(screen.getByText('One-time'));
  await waitFor(() => expect(screen.getByLabelText('Date *')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Date *'), { target: { value: FUTURE_DATE } });
  // Kids load selected:true from the mocked kids snapshot.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(h.callable).toHaveBeenCalledWith('searchBabysitters', expect.anything()));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.snapshotNext = null;
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
  h.callable.mockResolvedValue({ data: { results: [] } });
});

afterEach(cleanup);

describe('SearchPage publish flow (issue #207)', () => {
  it('offers the publish CTA on the empty results step and publishes with the form values', async () => {
    await searchToResults();
    // Empty results: the CTA is the primary escape hatch.
    fireEvent.click(screen.getByRole('button', { name: 'Publish this search' }));
    // The dialog carries the owner's widened-visibility copy.
    expect(screen.getByText(/larger group of babysitters/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith(
        'publishSearch',
        expect.objectContaining({
          type: 'one_time',
          date: FUTURE_DATE,
          startTime: '18:00',
          endTime: '22:00',
          kidIds: ['kid1'],
        }),
      ),
    );
    // The published payload must NOT carry the family's address or latLng —
    // the callable derives the area label server-side.
    const payload = h.callable.mock.calls.find((c) => c[0] === 'publishSearch')![1] as Record<string, unknown>;
    expect(payload.address).toBeUndefined();
    expect(payload.latLng).toBeUndefined();
  });

  it('surfaces the dedicated cap message on resource-exhausted', async () => {
    await searchToResults();
    h.callable.mockImplementation((name: string) =>
      name === 'publishSearch'
        ? Promise.reject(Object.assign(new Error('cap'), { code: 'functions/resource-exhausted' }))
        : Promise.resolve({ data: { results: [] } }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish this search' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(screen.getByText(/maximum number of published searches/)).toBeInTheDocument(),
    );
  });

  it('lists own ACTIVE published searches on the type step (expired filtered client-side)', async () => {
    renderPage();
    await waitFor(() => expect(h.snapshotNext).toBeTruthy());
    h.snapshotNext!({
      docs: [
        pubDoc('ps1'),
        pubDoc('ps2', {
          expiresAt: { toMillis: () => NOW - 1000, toDate: () => new Date(NOW - 1000) },
        }),
      ],
    });
    await waitFor(() => expect(screen.getByText('Your published searches')).toBeInTheDocument());
    // Exactly ONE card (the active doc) — the expired one is filtered.
    expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1);
  });

  it('withdraws via a confirmed client delete of the doc', async () => {
    renderPage();
    await waitFor(() => expect(h.snapshotNext).toBeTruthy());
    h.snapshotNext!({ docs: [pubDoc('ps1')] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const buttons = await screen.findAllByRole('button', { name: 'Withdraw' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(h.deleteDoc).toHaveBeenCalledWith({ path: 'publishedSearches/ps1' }),
    );
  });
});
