import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * Published-searches surface on the family SearchPage (issue #207): the
 * publish CTA + confirm dialog (publishTutorSearch callable), the cap error,
 * and the own-active list with client-side expiry filtering and withdraw
 * (rules-gated client deleteDoc). The search flow itself is pinned in
 * SearchPage.test.tsx.
 */

const NOW = Date.now();

const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 'p1' } as { uid: string } | null,
    userDoc: null as unknown,
  },
  getDoc: vi.fn(),
  callable: vi.fn(),
  // onSnapshot(query, next, error): capture `next` so tests can push docs.
  snapshotNext: null as ((snap: unknown) => void) | null,
  snapshotQueries: [] as unknown[],
  deleteDoc: vi.fn(() => Promise.resolve()),
  unsub: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  onSnapshot: (q: unknown, next: (snap: unknown) => void) => {
    h.snapshotQueries.push(q);
    h.snapshotNext = next;
    return h.unsub;
  },
  deleteDoc: (...args: unknown[]) => h.deleteDoc(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { SearchPage } from '../SearchPage';

function parentDoc() {
  return {
    uid: 'p1',
    firstName: 'Dana',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
  };
}

/** Fake published-search snapshot doc. */
function pubDoc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      id,
      app: 'study',
      familyId: 'fam1',
      subject: 'math',
      level: '6e',
      createdAt: { toMillis: () => NOW - 1000 },
      expiresAt: { toMillis: () => NOW + 86400000, toDate: () => new Date(NOW + 86400000) },
      ...overrides,
    }),
  };
}

async function renderAndSearch() {
  renderWithProviders(<SearchPage />);
  // Let the family doc load resolve.
  await waitFor(() => expect(h.getDoc).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'math' } });
  fireEvent.change(screen.getByLabelText('Level'), { target: { value: '6e' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search tutors' }));
  await waitFor(() => expect(h.callable).toHaveBeenCalledWith('searchTutors', expect.anything()));
  // The callable having been *invoked* is not the settled state. The publish CTA
  // renders only after the search promise resolves and the page leaves its
  // loading branch, so callers that click it straight away were racing a
  // microtask -- green locally, red on a slower CI runner. Wait for the CTA
  // itself, which is the real post-condition of "a search has run".
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Publish this search' })).toBeTruthy(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.snapshotNext = null;
  h.snapshotQueries = [];
  h.auth.userDoc = parentDoc();
  h.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
  h.callable.mockResolvedValue({ data: { results: [] } });
});

describe('SearchPage publish flow (issue #207)', () => {
  it('shows the publish CTA once a search has run, and not before', async () => {
    renderWithProviders(<SearchPage />);
    await waitFor(() => expect(h.getDoc).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Publish this search' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'math' } });
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '6e' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search tutors' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Publish this search' })).toBeTruthy(),
    );
  });

  // Pins the `!loading` half of the CTA's render guard (SearchPage.tsx:479).
  // It only does real work on a RE-search: `setLoading(true)` fires while
  // `results` still holds the previous run's array, so `results !== null` alone
  // would leave the CTA on screen mid-search. Holding the second search open
  // makes that window deterministic. A first search cannot pin this -- `results`
  // is still null then, so the guard passes on that clause alone.
  it('hides the publish CTA again while a re-search is in flight', async () => {
    await renderAndSearch();
    expect(screen.getByRole('button', { name: 'Publish this search' })).toBeTruthy();

    let release!: (v: unknown) => void;
    h.callable.mockReturnValueOnce(
      new Promise((r) => {
        release = r;
      }),
    );
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '5e' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search tutors' }));

    // Second search in flight, stale results still in state: CTA must be gone.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Publish this search' })).toBeNull(),
    );

    release({ data: { results: [] } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Publish this search' })).toBeTruthy(),
    );
  });

  it('publishes via the publishTutorSearch callable with the current form values', async () => {
    await renderAndSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Publish this search' }));
    // The dialog carries the owner's widened-visibility copy.
    expect(screen.getByText(/larger group of tutors/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('publishTutorSearch', {
        subject: 'math',
        level: '6e',
      }),
    );
  });

  it('surfaces the dedicated cap message on resource-exhausted', async () => {
    await renderAndSearch();
    h.callable.mockImplementation((name: string) =>
      name === 'publishTutorSearch'
        ? Promise.reject(Object.assign(new Error('cap'), { code: 'functions/resource-exhausted' }))
        : Promise.resolve({ data: { results: [] } }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish this search' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(screen.getByText(/maximum number of published searches/)).toBeTruthy(),
    );
  });

  it('lists own ACTIVE published searches only (expired filtered client-side)', async () => {
    renderWithProviders(<SearchPage />);
    await waitFor(() => expect(h.snapshotNext).toBeTruthy());
    h.snapshotNext!({
      docs: [
        pubDoc('ps1'),
        pubDoc('ps2', {
          subject: 'physics',
          expiresAt: { toMillis: () => NOW - 1000, toDate: () => new Date(NOW - 1000) },
        }),
      ],
    });
    await waitFor(() => expect(screen.getByText('Your published searches')).toBeTruthy());
    // The card text interpolates as sibling text nodes — match on textContent.
    const cardText = (expected: string) => (_: string, el: Element | null) =>
      el?.tagName === 'P' && el.textContent === expected;
    expect(screen.getByText(cardText('Mathematics (6e)'))).toBeTruthy();
    // The expired physics doc must not render as a card ("Physics" still
    // exists as a subject <option>, so match the card's "subject (level)").
    expect(screen.queryByText(cardText('Physics (6e)'))).toBeNull();
  });

  it('withdraws via a confirmed client delete of the doc', async () => {
    renderWithProviders(<SearchPage />);
    await waitFor(() => expect(h.snapshotNext).toBeTruthy());
    h.snapshotNext!({ docs: [pubDoc('ps1')] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    // Confirm dialog: pick the confirm button (same label, inside the dialog).
    const buttons = await screen.findAllByRole('button', { name: 'Withdraw' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(h.deleteDoc).toHaveBeenCalledWith({ path: 'publishedSearches/ps1' }),
    );
  });
});
