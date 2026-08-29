import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';

/**
 * Cross-app endorsements on the family babysitter-search results (issue #280).
 *
 * Expanding a result card loads endorsements from the shared `references`
 * collection — ONE query per product, sit's own `babysitterUserId` first, the
 * siblings after — and labels every non-sit entry with its origin app. The
 * status-in constraint on each query is what makes the read provable under the
 * H2-hardened references rule for a family unrelated to the reference author.
 */

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_DATE = new Date(NOW + 3 * DAY_MS).toISOString().split('T')[0];

const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  getDoc: vi.fn(),
  callable: vi.fn(),
  refQueries: [] as unknown[][],
  /** Rows per `references` subject field — one query is issued per product. */
  refResults: new Map<string, Record<string, unknown>[]>(),
  refFail: false,
  /** Subject fields whose query should reject — models a partial outage. */
  refFailFields: new Set<string>(),
  unsub: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  limit: (n: number) => ({ limit: n }),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
  getDocs: (target: { path?: string; query?: unknown[] }) => {
    // Unwrapped collection reads (kids) vs. built queries (references, etc.).
    const parts = target.query ?? [target];
    const path = (parts[0] as { path?: string }).path;
    if (path?.endsWith('/kids')) {
      return Promise.resolve({
        docs: [{ id: 'kid1', data: () => ({ firstName: 'Lucas', age: 6, languages: ['fr'] }) }],
      });
    }
    if (path !== 'references') return Promise.resolve({ docs: [] });
    h.refQueries.push(parts);
    if (h.refFail) return Promise.reject(new Error('permission-denied'));
    const field = (parts[1] as { where: [string] }).where[0];
    if (h.refFailFields.has(field)) return Promise.reject(new Error('permission-denied'));
    const rows = h.refResults.get(field) ?? [];
    return Promise.resolve({ docs: rows.map((r, i) => ({ id: `${field}-${i}`, data: () => r })) });
  },
  onSnapshot: () => h.unsub,
  deleteDoc: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => ({ periods: [], loading: false }) }));

import '@/i18n';
import { SearchPage } from '../SearchPage';

/** Drive the wizard to results carrying one babysitter, then expand her card. */
async function expandFirstResult() {
  render(
    <ToastProvider>
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText('One-time'));
  await waitFor(() => expect(screen.getByLabelText('Date *')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Date *'), { target: { value: FUTURE_DATE } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  // Clicking the name bubbles to the Card, whose onClick expands + loads.
  fireEvent.click(await screen.findByText('Marie DUPONT'));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.refQueries = [];
  h.refResults = new Map();
  h.refFail = false;
  h.refFailFields = new Set();
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
  h.callable.mockImplementation((name: string) =>
    name === 'searchBabysitters'
      ? Promise.resolve({
          data: {
            results: [
              { uid: 'bs-1', firstName: 'Marie', lastName: 'Dupont', age: 22, rate: 15 },
            ],
          },
        })
      : Promise.resolve({ data: {} }),
  );
});

afterEach(cleanup);

describe('SearchPage cross-app endorsements (issue #280)', () => {
  it('issues one status-constrained references query per product, sit first', async () => {
    await expandFirstResult();
    await waitFor(() => expect(h.refQueries).toHaveLength(3));
    // Fields AND their order pinned per query, not derived from the query
    // under test — sit's own field must lead.
    const fields = ['babysitterUserId', 'tutorUserId', 'doerUserId'];
    h.refQueries.forEach((q, i) => {
      expect(q[1]).toEqual({ where: [fields[i], '==', 'bs-1'] });
      // NOT optional: the H2-hardened rule grants an unrelated family only the
      // public-status disjunct, and Firestore proves it from the QUERY.
      expect(q[2]).toEqual({ where: ['status', 'in', ['approved', 'published']] });
      expect(q[3]).toEqual({ limit: 10 });
    });
  });

  it('lists sit references first, then the study one labeled with its origin', async () => {
    h.refResults.set('babysitterUserId', [
      { refName: 'Famille Garde', note: 'Sat for us for two years' },
    ]);
    h.refResults.set('tutorUserId', [
      { submittedByName: 'Famille Etude', referenceText: 'Patient maths tutor' },
    ]);
    await expandFirstResult();

    const rows = await waitFor(() => {
      const found = screen
        .getAllByRole('button')
        .filter((b) => /Endorsement from/.test(b.textContent ?? ''));
      expect(found).toHaveLength(2);
      return found;
    });
    expect(rows[0].textContent).toContain('Famille Garde');
    expect(rows[1].textContent).toContain('Famille Etude');
    // Only the cross-app row carries an origin label.
    expect(rows[0].textContent).not.toContain('From Sync/');
    expect(rows[1].textContent).toContain('From Sync/Study');
  });

  it('counts the cross-app entries in the section header', async () => {
    h.refResults.set('babysitterUserId', [{ refName: 'A', note: 'x' }]);
    h.refResults.set('tutorUserId', [{ submittedByName: 'B', referenceText: 'y' }]);
    await expandFirstResult();
    expect(await screen.findByText(/Endorsements \(2\)/)).toBeInTheDocument();
  });

  it('renders a sync-do endorsement labeled From Sync/Do (PR-11 needs no code change here)', async () => {
    // The registry and the label key already cover `do`; this pins that the
    // i18n key actually RESOLVES, which TypeScript cannot.
    h.refResults.set('doerUserId', [
      { submittedByName: 'Famille Bricolage', referenceText: 'Assembled our shelves' },
    ]);
    await expandFirstResult();
    expect(await screen.findByText(/Endorsement from Famille Bricolage/)).toBeInTheDocument();
    expect(screen.getByText('From Sync/Do')).toBeInTheDocument();
  });

  it('keeps sit references when only a SIBLING query fails (allSettled, not all)', async () => {
    // The regression this guards: with Promise.all, one failing secondary
    // source hid the primary signal — five good sit references showing zero.
    h.refResults.set('babysitterUserId', [
      { refName: 'Famille Garde', note: 'Sat for us for two years' },
    ]);
    h.refFailFields = new Set(['tutorUserId', 'doerUserId']);
    await expandFirstResult();
    expect(await screen.findByText(/Endorsement from Famille Garde/)).toBeInTheDocument();
    expect(screen.queryByText(/From Sync\//)).not.toBeInTheDocument();
  });

  it('never renders referee contact details for a cross-app entry', async () => {
    // Sibling docs do not carry these fields today; the gate keeps a future
    // one from being rendered as a babysitting-referee mailto/tel by this
    // shared row markup.
    h.refResults.set('tutorUserId', [
      {
        submittedByName: 'Famille Etude',
        referenceText: 'Patient maths tutor',
        refEmail: 'etude@example.com',
        refPhone: '+33100000000',
        numberOfKids: 2,
      },
    ]);
    await expandFirstResult();
    const row = await screen.findByRole('button', { name: /Endorsement from Famille Etude/ });
    fireEvent.click(row);
    expect(await screen.findByText(/Patient maths tutor/)).toBeInTheDocument();
    expect(screen.queryByText(/etude@example\.com/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+33100000000/)).not.toBeInTheDocument();
  });

  it('retries on re-expand after a PARTIAL failure — degradation is not cached', async () => {
    // Regression guard: allSettled always yields an array, so caching it as a
    // complete answer would make a one-off sibling failure permanent for the
    // session — a family who expands while the (tutorUserId, status) composite
    // is still building would keep seeing the incomplete list after it lands.
    h.refResults.set('babysitterUserId', [{ refName: 'Famille Garde', note: 'x' }]);
    h.refResults.set('tutorUserId', [
      { submittedByName: 'Famille Etude', referenceText: 'Patient maths tutor' },
    ]);
    h.refFailFields = new Set(['tutorUserId']);
    await expandFirstResult();
    await waitFor(() => expect(h.refQueries).toHaveLength(3));
    expect(screen.queryByText(/Famille Etude/)).not.toBeInTheDocument();

    // The sibling recovers; collapse and re-expand must refetch.
    h.refFailFields = new Set();
    fireEvent.click(screen.getByText('Marie DUPONT'));
    fireEvent.click(screen.getByText('Marie DUPONT'));
    await waitFor(() => expect(h.refQueries).toHaveLength(6));
    expect(await screen.findByText(/Endorsement from Famille Etude/)).toBeInTheDocument();
  });

  it('does NOT refetch once a load has fully succeeded', async () => {
    h.refResults.set('babysitterUserId', [{ refName: 'Famille Garde', note: 'x' }]);
    await expandFirstResult();
    await waitFor(() => expect(h.refQueries).toHaveLength(3));
    fireEvent.click(screen.getByText('Marie DUPONT'));
    fireEvent.click(screen.getByText('Marie DUPONT'));
    // Still 3: a complete answer stays cached, so the cost is paid once.
    await waitFor(() => expect(screen.getByText(/Famille Garde/)).toBeInTheDocument());
    expect(h.refQueries).toHaveLength(3);
  });

  it('leaves the card intact when the endorsement queries are denied', async () => {
    h.refFail = true;
    await expandFirstResult();
    await waitFor(() => expect(h.refQueries).toHaveLength(3));
    expect(screen.getByText('Marie DUPONT')).toBeInTheDocument();
    expect(screen.queryByText(/Endorsement from/)).not.toBeInTheDocument();
  });
});
