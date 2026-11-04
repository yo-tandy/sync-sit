import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';
import { ENDORSEMENT_SUBJECT_FIELD } from '@ejm/shared-core';

/**
 * Cross-app endorsements on the family babysitter-search results (issue
 * #280), server-side projected for sibling apps (issue #346 — PII
 * minimisation).
 *
 * Expanding a result card loads sit's OWN references via a direct Firestore
 * query (status-in constrained — that is what makes the read provable under
 * the H2-hardened references rule) and every SIBLING app's endorsements via
 * the shared `getCrossAppReferences` callable, sit first. This suite pins
 * that the card never falls back to a raw Firestore query for a sibling
 * source, and that a projected row still never renders referee contact
 * fields even if one somehow arrived with them.
 */

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_DATE = new Date(NOW + 3 * DAY_MS).toISOString().split('T')[0];

const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  getDoc: vi.fn(),
  callable: vi.fn(),
  refQueries: [] as unknown[][],
  /** Rows per `references` subject field — one source per product. */
  refResults: new Map<string, Record<string, unknown>[]>(),
  refFail: false,
  /** Subject fields whose source should reject — models a partial outage. */
  refFailFields: new Set<string>(),
  /** Subject fields whose source hangs until released — models slow sources. */
  refHold: new Map<string, () => void>(),
  unsub: vi.fn(),
}));

/** Mirrors the getCrossAppReferences callable's own mapping, plus (deliberately)
 * carrying any extra fields a test's fixture set — so a test can exercise the
 * CLIENT-side render gate even if a row somehow arrived with more than the
 * callable is meant to send. The callable's own key-set discipline is pinned
 * server-side (tests/integration/references/get-cross-app-references.test.ts). */
function project(sourceApp: string, field: string, r: Record<string, unknown>, i: number) {
  const refName =
    (typeof r.submittedByName === 'string' && r.submittedByName) ||
    (typeof r.refName === 'string' && r.refName) ||
    '';
  const text =
    (typeof r.referenceText === 'string' && r.referenceText) ||
    (typeof r.note === 'string' && r.note) ||
    '';
  return { sourceApp, id: `${field}-${i}`, refName, text, isEjmFamily: r.isEjmFamily === true, ...r };
}

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
    if (field !== 'babysitterUserId') {
      // sit's own is the ONLY subject field a raw query may ever carry now —
      // a sibling field arriving here means a regression back to the
      // pre-#346 direct-read path.
      throw new Error(`unexpected raw Firestore query for sibling field ${String(field)}`);
    }
    if (h.refFailFields.has(field)) return Promise.reject(new Error('permission-denied'));
    const rows = h.refResults.get(field) ?? [];
    const result = { docs: rows.map((r, i) => ({ id: `${field}-${i}`, data: () => r })) };
    if (h.refHold.has(field)) {
      return new Promise((resolve) => {
        h.refHold.set(field, () => resolve(result));
      });
    }
    return Promise.resolve(result);
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
  h.refHold = new Map();
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
  h.callable.mockImplementation(
    (name: string, payload?: { providerUserId?: string; sourceApp?: 'study' | 'do' }) => {
      if (name === 'searchBabysitters') {
        return Promise.resolve({
          data: {
            results: [
              { uid: 'bs-1', firstName: 'Marie', lastName: 'Dupont', age: 22, rate: 15 },
            ],
          },
        });
      }
      if (name === 'getCrossAppReferences' && payload?.sourceApp) {
        const field = ENDORSEMENT_SUBJECT_FIELD[payload.sourceApp];
        if (h.refFail) return Promise.reject(new Error('internal'));
        if (h.refFailFields.has(field)) return Promise.reject(new Error('internal'));
        const rows = h.refResults.get(field) ?? [];
        const result = { data: { items: rows.map((r, i) => project(payload.sourceApp!, field, r, i)) } };
        if (h.refHold.has(field)) {
          return new Promise((resolve) => {
            h.refHold.set(field, () => resolve(result));
          });
        }
        return Promise.resolve(result);
      }
      return Promise.resolve({ data: {} });
    },
  );
});

afterEach(cleanup);

/** getCrossAppReferences calls issued so far, in order. */
function crossAppCalls() {
  return h.callable.mock.calls.filter(([name]) => name === 'getCrossAppReferences');
}

describe('SearchPage cross-app endorsements (issue #280, projected per #346)', () => {
  it("issues one status-constrained Firestore query for sit's OWN source", async () => {
    await expandFirstResult();
    await waitFor(() => expect(h.refQueries).toHaveLength(1));
    const q = h.refQueries[0];
    expect(q[1]).toEqual({ where: ['babysitterUserId', '==', 'bs-1'] });
    // NOT optional: the H2-hardened rule grants an unrelated family only the
    // public-status disjunct, and Firestore proves it from the QUERY.
    expect(q[2]).toEqual({ where: ['status', 'in', ['approved', 'published']] });
    expect(q[3]).toEqual({ limit: 10 });
  });

  it('calls getCrossAppReferences for each SIBLING source, sit excluded, and never issues a raw Firestore query for them', async () => {
    await expandFirstResult();
    await waitFor(() => expect(crossAppCalls()).toHaveLength(2));
    expect(crossAppCalls().map(([, payload]) => payload)).toEqual([
      { providerUserId: 'bs-1', sourceApp: 'study' },
      { providerUserId: 'bs-1', sourceApp: 'do' },
    ]);
    // The mocked firestore getDocs throws if a sibling field ever reaches it
    // (see the mock above) — reaching this line without a throw already
    // proves the point; this asserts it wasn't reached at all.
    expect(h.refQueries).toHaveLength(1);
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

  it('never renders referee contact details for a cross-app entry, even if the projection carried them', async () => {
    // A row from the getCrossAppReferences mock carrying extra fields models
    // a hypothetical projection regression — the render gate is the
    // last-line defense documented at the `sourceApp === 'sit'` check in
    // SearchPage.tsx; this proves it still holds.
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
    await waitFor(() => expect(crossAppCalls()).toHaveLength(2));
    expect(screen.queryByText(/Famille Etude/)).not.toBeInTheDocument();

    // The sibling recovers; collapse and re-expand must refetch.
    h.refFailFields = new Set();
    fireEvent.click(screen.getByText('Marie DUPONT'));
    fireEvent.click(screen.getByText('Marie DUPONT'));
    await waitFor(() => expect(crossAppCalls()).toHaveLength(4));
    expect(await screen.findByText(/Endorsement from Famille Etude/)).toBeInTheDocument();
  });

  it('does NOT refetch once a load has fully succeeded', async () => {
    h.refResults.set('babysitterUserId', [{ refName: 'Famille Garde', note: 'x' }]);
    await expandFirstResult();
    await waitFor(() => expect(h.refQueries).toHaveLength(1));
    await waitFor(() => expect(crossAppCalls()).toHaveLength(2));
    fireEvent.click(screen.getByText('Marie DUPONT'));
    fireEvent.click(screen.getByText('Marie DUPONT'));
    // Still 1 + 2: a complete answer stays cached, so the cost is paid once.
    await waitFor(() => expect(screen.getByText(/Famille Garde/)).toBeInTheDocument());
    expect(h.refQueries).toHaveLength(1);
    expect(crossAppCalls()).toHaveLength(2);
  });

  it('does not start a second load while one is in flight (no stale overwrite, no double reads)', async () => {
    // The race the completeness flag alone does NOT close: collapse-then-
    // expand while load A is still running starts load B; if B (complete)
    // resolves first and A (partial) second, A overwrites the full list while
    // the complete flag is already latched — sticky degradation again, by
    // another door. Deduping per uid makes the interleaving impossible.
    h.refResults.set('babysitterUserId', [{ refName: 'Famille Garde', note: 'x' }]);
    h.refHold.set('tutorUserId', () => {}); // this source hangs
    await expandFirstResult();
    await waitFor(() => expect(crossAppCalls()).toHaveLength(2));

    // Double-toggle while load A is unresolved.
    fireEvent.click(screen.getByText('Marie DUPONT'));
    fireEvent.click(screen.getByText('Marie DUPONT'));
    // Still 2, not 4: no second query set was issued.
    expect(crossAppCalls()).toHaveLength(2);

    // Release the hung source; the single in-flight load completes normally.
    h.refHold.get('tutorUserId')!();
    await waitFor(() => expect(screen.getByText(/Famille Garde/)).toBeInTheDocument());
  });

  it('leaves the card intact when the endorsement sources are denied', async () => {
    h.refFail = true;
    await expandFirstResult();
    await waitFor(() => expect(h.refQueries).toHaveLength(1));
    await waitFor(() => expect(crossAppCalls()).toHaveLength(2));
    expect(screen.getByText('Marie DUPONT')).toBeInTheDocument();
    expect(screen.queryByText(/Endorsement from/)).not.toBeInTheDocument();
  });
});
