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
  h.where.mockClear();
  h.orderBy.mockClear();
  h.listeners = {};
  h.unsubscribe.mockClear();
  h.onSnapshot.mockReset();
  // Single listener (studyContactRequests) since the endorsements section
  // moved to its own page (#191). Captures the listener, delivers the
  // initial snapshot synchronously, and hands back the shared unsubscribe
  // spy (asserted on unmount).
  h.onSnapshot.mockImplementation(
    (query: unknown, next: (snap: Snapshot) => void, error: (err: unknown) => void) => {
      const q = query as { query: { path: string }[] };
      const path = q?.query?.[0]?.path;
      h.listeners[path] = { query: q, next, error };
      next(snapOf(h.requests));
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

  it('unsubscribes the requests listener on unmount (endorsements moved to their own page, #191)', async () => {
    h.requests = [reqDoc()];
    const { unmount } = renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);

    unmount();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('surfaces a load error when the requests subscription errors — not an empty list', async () => {
    h.onSnapshot.mockImplementation(
      (query: unknown, next: (snap: Snapshot) => void, error: (err: unknown) => void) => {
        const q = query as { query: { path: string }[] };
        const path = q?.query?.[0]?.path;
        h.listeners[path] = { query: q, next, error };
        // The requests listener errors (e.g. PERMISSION_DENIED).
        if (path === 'studyContactRequests') error(new Error('permission-denied'));
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
    // The empty state carries the next step (issue #125): a link into search.
    const action = screen.getByRole('link', { name: 'Find a tutor' });
    expect(action).toHaveAttribute('href', '/family/search');
  });

  it('subscribes on a legacy Plan C ROOT familyId, so a dashboard row does not dead-end', async () => {
    // The dashboard lists this family's live requests and every row links
    // here; reading the profile pointer alone sent a Plan C parent from N rows
    // straight to "No requests yet" (PR #345 round 4). Both surfaces resolve
    // membership the same way now — getFamilyId, the same two places
    // hasFamilyMembership accepts.
    h.auth.userDoc = {
      uid: 'p1',
      familyId: 'fam-legacy',
      profiles: { parent: { enrollmentComplete: true } },
    };
    renderWithProviders(<RequestsPage />);
    await waitFor(() => expect(h.onSnapshot).toHaveBeenCalled());
    expect(h.where).toHaveBeenCalledWith('familyId', '==', 'fam-legacy');
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

  // ── Inverted rows: a tutor answered this family's published search
  //    (issue #207 PR4). The family ANSWERS these instead of cancelling them.
  it('a tutor-initiated pending row offers Accept/Decline instead of Cancel, and says who reached out', async () => {
    h.requests = [reqDoc({ requestId: 'r9', initiatedBy: 'tutor', publishedSearchId: 'ps1' })];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);

    expect(screen.getByText(/answered your published search/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel request/i })).not.toBeInTheDocument();
  });

  it('accepting calls respondToFamilyContactRequest and moves the row only after it resolves', async () => {
    h.requests = [reqDoc({ requestId: 'r9', initiatedBy: 'tutor' })];
    h.callable.mockResolvedValue({ data: { success: true } });
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);

    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToFamilyContactRequest', {
        requestId: 'r9',
        action: 'accept',
      }),
    );
    // Accepted rows carry the contact deep-link, whoever opened the request.
    expect(await screen.findByRole('link', { name: /view contact details/i })).toBeInTheDocument();
  });

  it('declining calls the same callable with action decline', async () => {
    h.requests = [reqDoc({ requestId: 'r9', initiatedBy: 'tutor' })];
    h.callable.mockResolvedValue({ data: { success: true } });
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);

    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }));
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToFamilyContactRequest', {
        requestId: 'r9',
        action: 'decline',
      }),
    );
  });

  it('an accept refused because the tutor is gone says so, instead of "please try again"', async () => {
    // Every accept-side re-check (hidden, suspended, deleted, subject
    // dropped) is unretryable, so the generic copy was an invitation to keep
    // tapping a call that can never succeed (PR #213 review).
    h.requests = [reqDoc({ requestId: 'r9', initiatedBy: 'tutor' })];
    h.callable.mockRejectedValue({ details: { reason: 'tutor_unavailable' } });
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);

    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
  });

  it('a FAMILY-initiated pending row is untouched by the inversion (regression pin)', async () => {
    h.requests = [reqDoc({ requestId: 'r1' })];
    renderWithProviders(<RequestsPage />);
    await screen.findByText(/Alex Roy/);

    expect(screen.getByRole('button', { name: /cancel request/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^accept$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/answered your published search/i)).not.toBeInTheDocument();
  });

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



});
