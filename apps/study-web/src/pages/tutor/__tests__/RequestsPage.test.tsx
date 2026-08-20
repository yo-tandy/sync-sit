import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The tutor RequestsPage subscribes to
// studyContactRequests where tutorUserId==me via onSnapshot (sorted
// client-side, see the component note) and responds via the
// respondToTutorContactRequest callable. The mock captures each listener so
// tests can push follow-up snapshots (the live-update pin of issue #117).
type Snapshot = { docs: { id: string; data: () => Record<string, unknown> }[] };
const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 't1' } as { uid: string } | null },
  requests: [] as Record<string, unknown>[],
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  onSnapshot: vi.fn(),
  unsubscribe: vi.fn(),
  listeners: [] as {
    query: { query: { path: string }[] };
    next: (snap: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void;
    error: (err: unknown) => void;
  }[],
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  onSnapshot: (...args: unknown[]) => h.onSnapshot(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { RequestsPage } from '../RequestsPage';

/** A promise whose settlement the test controls, for asserting in-flight state. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function ts(seconds: number) {
  return { seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) };
}

function reqDoc(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'r1',
    tutorUserId: 't1',
    familyId: 'fam1',
    familyName: 'Cohen',
    parentName: 'Dana Weiss',
    tutorName: 'Alex Roy',
    subject: 'math',
    level: '6e',
    message: 'Looking for weekly help.',
    status: 'pending',
    createdAt: ts(1_700_000_000),
    ...overrides,
  };
}

function snapOf(rows: Record<string, unknown>[]): Snapshot {
  return { docs: rows.map((r) => ({ id: r.requestId as string, data: () => r })) };
}

function reset() {
  h.auth.firebaseUser = { uid: 't1' };
  h.requests = [];
  h.where.mockClear();
  h.listeners = [];
  h.unsubscribe.mockClear();
  h.onSnapshot.mockReset();
  // Capture the listener, deliver the initial snapshot synchronously, and hand
  // back the unsubscribe spy (asserted on unmount).
  h.onSnapshot.mockImplementation(
    (query: unknown, next: (snap: Snapshot) => void, error: (err: unknown) => void) => {
      h.listeners.push({ query: query as { query: { path: string }[] }, next, error });
      next(snapOf(h.requests));
      return h.unsubscribe;
    },
  );
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { success: true } });
}

describe('tutor RequestsPage', () => {
  beforeEach(() => reset());

  it('subscribes to studyContactRequests for the signed-in tutor', async () => {
    h.requests = [reqDoc()];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Cohen/);

    // The provability pin: the onSnapshot query carries the SAME equality
    // constraint the getDocs read did.
    expect(h.where).toHaveBeenCalledWith('tutorUserId', '==', 't1');
    const collectionArg = h.onSnapshot.mock.calls[0][0].query[0];
    expect(collectionArg.path).toBe('studyContactRequests');
  });

  it('renders a newly arrived request from a follow-up snapshot without any refetch (live update)', async () => {
    h.requests = [reqDoc({ requestId: 'r1', familyName: 'Cohen' })];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Cohen/);

    // A new request lands in Firestore while the tab is open — the listener
    // pushes it and the page renders it in place: no new subscription, no
    // getDocs, no navigation.
    act(() =>
      h.listeners[0].next(
        snapOf([
          reqDoc({ requestId: 'r1', familyName: 'Cohen' }),
          reqDoc({ requestId: 'r2', familyName: 'Levi', createdAt: ts(1_700_000_100) }),
        ]),
      ),
    );

    expect(await screen.findByText(/Levi/)).toBeInTheDocument();
    expect(screen.getByText(/Cohen/)).toBeInTheDocument();
    expect(h.onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes the listener on unmount', async () => {
    h.requests = [reqDoc()];
    const { unmount } = renderWithProviders(<RequestsPage />);
    await screen.findByText(/Cohen/);

    unmount();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('empty inbox shows the empty state with a link to review subjects', async () => {
    h.requests = [];
    renderWithProviders(<RequestsPage />);
    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
    // The tutor cannot create requests — the next step is discoverability
    // (issue #125): keep subjects current so families find you.
    const action = screen.getByRole('link', { name: 'Review your subjects' });
    expect(action).toHaveAttribute('href', '/tutor/subjects');
  });

  it('surfaces a load error when the subscription errors — not an empty list', async () => {
    h.requests = [];
    // Deliver an error instead of a first snapshot (e.g. PERMISSION_DENIED).
    h.onSnapshot.mockImplementation(
      (query: unknown, _next: (snap: Snapshot) => void, error: (err: unknown) => void) => {
        h.listeners.push({
          query: query as { query: { path: string }[] },
          next: _next,
          error,
        });
        error(new Error('permission-denied'));
        return h.unsubscribe;
      },
    );
    renderWithProviders(<RequestsPage />);

    expect(await screen.findByText(/could not load your requests/i)).toBeInTheDocument();
    // The failure must NOT masquerade as "no requests yet".
    expect(screen.queryByText(/no requests yet/i)).not.toBeInTheDocument();
  });

  it('renders a pending request with family, parent, subject/level and message', async () => {
    h.requests = [reqDoc()];
    renderWithProviders(<RequestsPage />);

    expect(await screen.findByText(/Cohen/)).toBeInTheDocument();
    expect(screen.getByText(/Dana Weiss/)).toBeInTheDocument();
    expect(screen.getByText(/6e/)).toBeInTheDocument();
    expect(screen.getByText(/Looking for weekly help/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument();
  });

  it('accept → respondToTutorContactRequest({requestId, action:accept})', async () => {
    h.requests = [reqDoc({ requestId: 'rA' })];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToTutorContactRequest', {
        requestId: 'rA',
        action: 'accept',
      }),
    );
  });

  it('decline requires confirmation, then sends action:decline', async () => {
    h.requests = [reqDoc({ requestId: 'rD' })];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^decline$/i }));

    // Confirm dialog — nothing sent until confirmed.
    expect(h.callable).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /yes, decline/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToTutorContactRequest', {
        requestId: 'rD',
        action: 'decline',
      }),
    );
    // Declined confirmation toast after resolve.
    expect(await screen.findByRole('status')).toHaveTextContent(/declined/i);
  });

  it('applies the accepted status ONLY after the callable resolves (non-optimistic)', async () => {
    const d = deferred<{ data: { success: boolean } }>();
    h.callable.mockReturnValue(d.promise);
    h.requests = [reqDoc()];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    // In flight: row is STILL pending (Accept present) but its actions are disabled.
    expect(screen.getByRole('button', { name: /accept/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeDisabled();

    // Resolve → row moves to history, actions disappear.
    d.resolve({ data: { success: true } });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument(),
    );
    // Confirmation toast fires only after the callable resolved (shared idiom).
    expect(screen.getByRole('status')).toHaveTextContent(/accepted/i);
  });

  it('keeps the row pending + re-enabled and shows an error when the callable rejects', async () => {
    const d = deferred<{ data: { success: boolean } }>();
    h.callable.mockReturnValue(d.promise);
    h.requests = [reqDoc()];
    renderWithProviders(<RequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));
    expect(screen.getByRole('button', { name: /accept/i })).toBeDisabled();

    d.reject({ code: 'functions/internal' });

    // Error surfaced; the row never flipped and its actions come back enabled.
    expect(await screen.findByText(/couldn.?t update|something went wrong/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accept/i })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument();
  });

  it('formats a plain Date createdAt (emulator rows) instead of blanking it', async () => {
    h.requests = [reqDoc({ createdAt: new Date('2026-07-10T12:00:00') })];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Cohen/);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('a request THIS TUTOR opened is not answerable here — it waits for the family', async () => {
    // Answering it would be the tutor approving their own contact: accept
    // writes the family into approvedFamilies (issue #207 PR4). The server
    // refuses it as well; this pin keeps the affordance from reappearing.
    h.requests = [reqDoc({ requestId: 'r9', initiatedBy: 'tutor', publishedSearchId: 'ps1' })];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Cohen/);

    expect(screen.getByText(/waiting for their answer/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^accept$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^decline$/i })).not.toBeInTheDocument();
  });

  it('a FAMILY-initiated pending keeps its Accept/Decline (regression pin)', async () => {
    h.requests = [reqDoc()];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Cohen/);

    expect(screen.getByRole('button', { name: /^accept$/i })).toBeInTheDocument();
    expect(screen.queryByText(/waiting for their answer/i)).not.toBeInTheDocument();
  });

  it('history rows (accepted/declined) are read-only', async () => {
    h.requests = [
      reqDoc({ requestId: 'r1', familyName: 'Accepted Fam', status: 'accepted' }),
      reqDoc({ requestId: 'r2', familyName: 'Declined Fam', status: 'declined' }),
    ];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Accepted Fam/);

    expect(screen.getByText(/Declined Fam/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^decline$/i })).not.toBeInTheDocument();
  });

  // ── Task 2: accepted requests unlock a tutor-initiated proposal ──
  it('offers "Propose a session" on an accepted row only (not pending/declined)', async () => {
    h.requests = [
      reqDoc({ requestId: 'r1', familyName: 'Accepted Fam', status: 'accepted' }),
      reqDoc({ requestId: 'r2', familyName: 'Declined Fam', status: 'declined' }),
      reqDoc({ requestId: 'r3', familyName: 'Pending Fam', status: 'pending' }),
    ];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Accepted Fam/);

    expect(screen.getAllByRole('button', { name: /propose a session/i })).toHaveLength(1);
  });
});
