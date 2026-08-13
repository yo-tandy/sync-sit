import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. RequestsPage subscribes via onSnapshot to
// studyContactRequests where familyId==mine orderBy createdAt desc (composite
// index exists) and groups the rows by status, plus this family's submitted
// endorsements in `references`. The mock captures each listener (keyed by
// collection path) so tests can push follow-up snapshots (the live-update pin
// of issue #117).
type Snapshot = { docs: { id: string; data: () => Record<string, unknown> }[] };
const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  requests: [] as Record<string, unknown>[],
  // references docs (this family's submitted endorsements).
  refs: [] as Record<string, unknown>[],
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  orderBy: vi.fn((field: string, dir: string) => ({ orderBy: [field, dir] })),
  onSnapshot: vi.fn(),
  unsubscribe: vi.fn(),
  listeners: {} as Record<
    string,
    {
      query: { query: { path: string }[] };
      next: (snap: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void;
      error: (err: unknown) => void;
    }
  >,
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  orderBy: (...args: [string, string]) => h.orderBy(...args),
  onSnapshot: (...args: unknown[]) => h.onSnapshot(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { RequestsPage } from '../RequestsPage';

function ts(iso: string) {
  const date = new Date(iso);
  return { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0, toDate: () => date };
}

function reqDoc(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'r1',
    tutorUserId: 't1',
    familyId: 'fam1',
    tutorName: 'Alex Roy',
    subject: 'math',
    level: '6e',
    status: 'pending',
    createdAt: ts('2026-07-10'),
    ...overrides,
  };
}

function refDoc(overrides: Record<string, unknown> = {}) {
  return {
    referenceId: 'e1',
    tutorUserId: 't1',
    appSource: 'study',
    submittedByFamilyId: 'fam1',
    refName: 'Dana Weiss',
    referenceText: 'Alex was patient and my daughter improved.',
    subject: 'math',
    status: 'private',
    createdAt: ts('2026-07-01'),
    ...overrides,
  };
}

function snapOf(rows: Record<string, unknown>[]): Snapshot {
  return {
    docs: rows.map((r) => ({ id: (r.referenceId ?? r.requestId) as string, data: () => r })),
  };
}

function reset() {
  h.auth.userDoc = {
    uid: 'p1',
    firstName: 'Dana',
    lastName: 'Weiss',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
  };
  h.requests = [];
  h.refs = [];
  h.where.mockClear();
  h.orderBy.mockClear();
  h.listeners = {};
  h.unsubscribe.mockClear();
  h.onSnapshot.mockReset();
  // Route by collection path: studyContactRequests => requests, references =>
  // this family's submitted endorsements. Captures the listener per path,
  // delivers the initial snapshot synchronously, and hands back the shared
  // unsubscribe spy (asserted on unmount).
  h.onSnapshot.mockImplementation(
    (query: unknown, next: (snap: Snapshot) => void, error: (err: unknown) => void) => {
      const q = query as { query: { path: string }[] };
      const path = q?.query?.[0]?.path;
      h.listeners[path] = { query: q, next, error };
      next(snapOf(path === 'references' ? h.refs : h.requests));
      return h.unsubscribe;
    },
  );
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { referenceId: 'e1' } });
}

describe('family RequestsPage', () => {
  beforeEach(() => reset());

  it('subscribes to studyContactRequests for the family, newest first', async () => {
    h.requests = [reqDoc()];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);

    // The provability pin: the onSnapshot query carries the SAME equality
    // constraint + orderBy the getDocs read did.
    expect(h.where).toHaveBeenCalledWith('familyId', '==', 'fam1');
    expect(h.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    const collectionArg = h.onSnapshot.mock.calls[0][0].query[0];
    expect(collectionArg.path).toBe('studyContactRequests');
  });

  it('renders a request status change from a follow-up snapshot without any refetch (live update)', async () => {
    h.requests = [reqDoc({ requestId: 'r1', tutorName: 'Alex Roy', status: 'pending' })];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);
    expect(screen.queryByRole('link', { name: /view contact details/i })).not.toBeInTheDocument();

    // The tutor accepts while the family's tab is open — the listener pushes
    // the new status and the accepted affordances appear in place: no new
    // subscription, no navigation.
    const subscriptionsBefore = h.onSnapshot.mock.calls.length;
    act(() =>
      h.listeners['studyContactRequests'].next(
        snapOf([reqDoc({ requestId: 'r1', tutorName: 'Alex Roy', status: 'accepted' })]),
      ),
    );

    expect(await screen.findByRole('link', { name: /view contact details/i })).toBeInTheDocument();
    expect(h.onSnapshot.mock.calls.length).toBe(subscriptionsBefore);
  });

  it('unsubscribes both listeners (requests + endorsements) on unmount', async () => {
    h.requests = [reqDoc()];
    const { unmount } = renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);

    unmount();
    expect(h.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('surfaces a load error when the requests subscription errors — not an empty list', async () => {
    h.onSnapshot.mockImplementation(
      (query: unknown, next: (snap: Snapshot) => void, error: (err: unknown) => void) => {
        const q = query as { query: { path: string }[] };
        const path = q?.query?.[0]?.path;
        h.listeners[path] = { query: q, next, error };
        // The requests listener errors (e.g. PERMISSION_DENIED); the
        // endorsements one delivers normally.
        if (path === 'studyContactRequests') error(new Error('permission-denied'));
        else next(snapOf(h.refs));
        return h.unsubscribe;
      },
    );
    renderWithProviders(<RequestsPage />);

    expect(await screen.findByText(/could not load your requests/i)).toBeInTheDocument();
    // The failure must NOT masquerade as "no requests yet".
    expect(screen.queryByText(/no requests yet/i)).not.toBeInTheDocument();
  });

  it('groups requests by status (pending / accepted / declined)', async () => {
    h.requests = [
      reqDoc({ requestId: 'r1', tutorName: 'Pending Tutor', status: 'pending' }),
      reqDoc({ requestId: 'r2', tutorName: 'Accepted Tutor', status: 'accepted' }),
      reqDoc({ requestId: 'r3', tutorName: 'Declined Tutor', status: 'declined' }),
    ];
    renderWithProviders(<RequestsPage />);

    // Exact strings: the accepted row now also renders an "Endorse Accepted
    // Tutor" button, so a /Accepted Tutor/ substring match would be ambiguous.
    expect(await screen.findByText('Pending Tutor')).toBeInTheDocument();
    expect(screen.getByText('Accepted Tutor')).toBeInTheDocument();
    expect(screen.getByText('Declined Tutor')).toBeInTheDocument();
  });

  it('renders subject taxonomy label + level for a row', async () => {
    h.requests = [reqDoc({ subject: 'math', level: '6e' })];
    renderWithProviders(<RequestsPage />);
    // 'math' resolves to its tutor.subjects.names.math label (EN: "Maths").
    expect(await screen.findByText(/6e/)).toBeInTheDocument();
  });

  it('accepted rows deep-link to the search page with subject & level prefilled', async () => {
    h.requests = [reqDoc({ status: 'accepted', subject: 'physics', level: '2nde' })];
    renderWithProviders(<RequestsPage />);
    const link = await screen.findByRole('link', { name: /view contact details/i });
    expect(link).toHaveAttribute('href', '/family/search?subject=physics&level=2nde');
  });

  it('non-accepted rows have no view-contact deep-link', async () => {
    h.requests = [reqDoc({ status: 'pending' })];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);
    expect(screen.queryByRole('link', { name: /view contact details/i })).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no requests', async () => {
    h.requests = [];
    renderWithProviders(<RequestsPage />);
    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
  });

  it('resolves to the empty state (no permanent spinner) when there is no familyId', async () => {
    h.auth.userDoc = { uid: 'p1', profiles: { parent: { enrollmentComplete: true } } };
    renderWithProviders(<RequestsPage />);
    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
    expect(h.onSnapshot).not.toHaveBeenCalled();
  });

  it('formats a plain Date createdAt (emulator rows) instead of blanking it', async () => {
    h.requests = [reqDoc({ createdAt: new Date('2026-07-10T12:00:00') })];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  // ── Endorse entry point (accepted rows) ──

  it('accepted rows expose an "Endorse {tutorName}" button; other statuses do not', async () => {
    h.requests = [
      reqDoc({ requestId: 'r1', tutorName: 'Accepted Tutor', status: 'accepted' }),
      reqDoc({ requestId: 'r2', tutorName: 'Pending Tutor', status: 'pending' }),
    ];
    renderWithProviders(<RequestsPage />);
    expect(await screen.findByRole('button', { name: /endorse accepted tutor/i })).toBeInTheDocument();
    // Only the accepted row gets an endorse button.
    expect(screen.getAllByRole('button', { name: /endorse/i })).toHaveLength(1);
  });

  it('endorsing a tutor opens the dialog, submits, then shows a disabled "Endorsed" state', async () => {
    h.requests = [reqDoc({ status: 'accepted', tutorName: 'Alex Roy', tutorUserId: 't1', subject: 'math' })];
    renderWithProviders(<RequestsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /endorse alex roy/i }));

    // Dialog open — fill the endorsement and submit.
    fireEvent.change(await screen.findByLabelText(/your endorsement/i), {
      target: { value: 'Alex was patient and my daughter improved a lot.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith(
        'submitTutorEndorsement',
        expect.objectContaining({ tutorUserId: 't1', refName: 'Dana Weiss', subject: 'math' }),
      ),
    );

    // The row's endorse button becomes a disabled "Endorsed" state.
    const endorsed = await screen.findByRole('button', { name: /^endorsed$/i });
    expect(endorsed).toBeDisabled();
    expect(screen.queryByRole('button', { name: /endorse alex roy/i })).not.toBeInTheDocument();
  });

  // ── Cancel a pending request ──

  it('pending rows expose a "Cancel request" action; other statuses do not', async () => {
    h.requests = [
      reqDoc({ requestId: 'r1', tutorName: 'Pending Tutor', status: 'pending' }),
      reqDoc({ requestId: 'r2', tutorName: 'Accepted Tutor', status: 'accepted' }),
      reqDoc({ requestId: 'r3', tutorName: 'Declined Tutor', status: 'declined' }),
    ];
    renderWithProviders(<RequestsPage />);
    await screen.findByText('Pending Tutor');
    // Exactly one cancel action (only the pending row).
    expect(screen.getAllByRole('button', { name: /cancel request/i })).toHaveLength(1);
  });

  it('cancelling a pending request confirms, calls cancelContactRequest with the requestId, then moves the row to cancelled (non-optimistic)', async () => {
    h.callable.mockReset();
    h.callable.mockResolvedValue({ data: { success: true } });
    h.requests = [reqDoc({ requestId: 'r1', tutorName: 'Alex Roy', status: 'pending' })];
    renderWithProviders(<RequestsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /cancel request/i }));

    // Confirm dialog — click the confirm CTA.
    fireEvent.click(await screen.findByRole('button', { name: /yes, cancel request/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelContactRequest', { requestId: 'r1' }),
    );

    // Row moves from the Pending section to a Cancelled chip; the cancel action
    // is gone (row is no longer pending).
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel request/i })).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Alex Roy/)).toBeInTheDocument();
    // Confirmation toast fires only after the callable resolved (shared idiom).
    expect(screen.getByRole('status')).toHaveTextContent(/cancelled/i);
  });

  it('does not call the callable if the family keeps the request (dismisses the dialog)', async () => {
    h.callable.mockReset();
    h.callable.mockResolvedValue({ data: { success: true } });
    h.requests = [reqDoc({ requestId: 'r1', tutorName: 'Alex Roy', status: 'pending' })];
    renderWithProviders(<RequestsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /cancel request/i }));
    fireEvent.click(await screen.findByRole('button', { name: /keep request/i }));

    expect(h.callable).not.toHaveBeenCalled();
    // Row is still pending with its cancel action.
    expect(screen.getByRole('button', { name: /cancel request/i })).toBeInTheDocument();
  });

  // ── "Your endorsements" section ──

  it('subscribes to references for this family\'s study endorsements (equality-only)', async () => {
    h.refs = [refDoc()];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex was patient/);

    expect(h.where).toHaveBeenCalledWith('submittedByFamilyId', '==', 'fam1');
    expect(h.where).toHaveBeenCalledWith('appSource', '==', 'study');
    const refsCall = h.onSnapshot.mock.calls.find(
      (c) => (c[0] as { query: { path: string }[] }).query[0].path === 'references',
    );
    expect(refsCall).toBeTruthy();
  });

  it('renders submitted endorsements with a status chip per status', async () => {
    h.refs = [
      refDoc({ referenceId: 'e1', referenceText: 'Pending endorsement', status: 'private' }),
      refDoc({ referenceId: 'e2', referenceText: 'Published endorsement', status: 'approved' }),
      refDoc({ referenceId: 'e3', referenceText: 'Removed endorsement', status: 'removed' }),
    ];
    renderWithProviders(<RequestsPage />);

    // All three are shown to the family (unlike the tutor side, removed is visible).
    expect(await screen.findByText(/Pending endorsement/)).toBeInTheDocument();
    expect(screen.getByText(/Published endorsement/)).toBeInTheDocument();
    expect(screen.getByText(/Removed endorsement/)).toBeInTheDocument();
  });

  it('client-sorts submitted endorsements newest-first (no composite index)', async () => {
    h.refs = [
      refDoc({ referenceId: 'old', referenceText: 'Older endorsement', createdAt: ts('2026-01-01') }),
      refDoc({ referenceId: 'new', referenceText: 'Newer endorsement', createdAt: ts('2026-06-01') }),
    ];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Newer endorsement/);

    const newer = screen.getByText(/Newer endorsement/);
    const older = screen.getByText(/Older endorsement/);
    // Newer appears before older in DOM order.
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The endorsements query does NOT use orderBy (equality-only, sorted client-side);
    // the requests query is the only orderBy caller.
    expect(h.orderBy).toHaveBeenCalledTimes(1);
  });
});
