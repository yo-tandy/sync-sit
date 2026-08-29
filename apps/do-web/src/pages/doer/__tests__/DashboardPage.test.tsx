import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * The doer portal's landing DASHBOARD (§9.0's route table, issue #360).
 * The load-bearing pins:
 * - the three query shapes, argument for argument — they are MyOffersPage's,
 *   MyWorkPage's and MyEndorsementsPage's, so nothing new reaches the server
 *   and each stays provable under §7.2 / served by §7.3;
 * - the §6.2 `pending_guardian` split, and that neither live-offer state
 *   counts toward the amber TO-DO badge (both await someone else);
 * - the endorsement section's shape filter, its place in the SETTLED check,
 *   and its error+retry — the empty state must never paint over an
 *   endorsement waiting for this student (PR #362 round 1);
 * - the board-pointing empty state.
 */

const NOW = Date.now();

const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown, firebaseUser: null as unknown },
  queries: [] as unknown[],
  getDocsCalls: [] as unknown[],
  offersNext: null as null | ((snap: unknown) => void),
  offersError: null as null | ((err: unknown) => void),
  tasksNext: null as null | ((snap: unknown) => void),
  tasksError: null as null | ((err: unknown) => void),
  referenceRows: [] as Record<string, unknown>[],
  referencesFail: false,
  referencesGate: null as Promise<void> | null,
  unsub: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  getDocs: (q: unknown) => {
    h.getDocsCalls.push(q);
    const settle = () =>
      h.referencesFail
        ? Promise.reject(new Error('denied'))
        : Promise.resolve({
            docs: h.referenceRows.map((r, i) => ({ id: `r${i}`, data: () => r })),
          });
    // `referencesGate` holds the one-shot read open, so a test can observe
    // the page WHILE it is in flight — the state the two snapshots alone
    // cannot produce.
    return h.referencesGate ? h.referencesGate.then(settle) : settle();
  },
  onSnapshot: (q: unknown, next: (snap: unknown) => void, error: (err: unknown) => void) => {
    h.queries.push(q);
    const path = (q as { query?: { path?: string }[] }).query?.[0]?.path;
    if (path === 'taskOffers') {
      h.offersNext = next;
      h.offersError = error;
    } else if (path === 'doTasks') {
      h.tasksNext = next;
      h.tasksError = error;
    }
    return h.unsub;
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { DashboardPage } from '../DashboardPage';

type Row = Record<string, unknown>;
function offerDoc(id: string, overrides: Row = {}): Row {
  return {
    offerId: id,
    taskId: `task-${id}`,
    doerUserId: 'd1',
    taskTitle: `Offer ${id}`,
    taskCategory: 'ikea',
    taskTiming: 'deadline',
    price: 40,
    priceBasis: 'flat',
    status: 'pending',
    ...overrides,
  };
}
function taskDoc(id: string, overrides: Row = {}): Row {
  return {
    taskId: id,
    title: `Task ${id}`,
    category: 'ikea',
    timing: 'deadline',
    dueDate: '2026-09-15',
    areaLabel: '15e',
    status: 'assigned',
    agreedPrice: 45,
    doerMarkedDoneAt: null,
    ...overrides,
  };
}
function referenceDoc(id: string, overrides: Row = {}): Row {
  return {
    referenceId: id,
    doerUserId: 'd1',
    appSource: 'do',
    type: 'family_submitted',
    status: 'private',
    submittedByName: `Family ${id}`,
    referenceText: 'Great work',
    createdAt: { toMillis: () => NOW },
    ...overrides,
  };
}

function pushOffers(rows: Row[]) {
  act(() => h.offersNext!({ docs: rows.map((r) => ({ id: r.offerId as string, data: () => r })) }));
}
function pushTasks(rows: Row[]) {
  act(() => h.tasksNext!({ docs: rows.map((r) => ({ id: r.taskId as string, data: () => r })) }));
}

/**
 * The page holds skeletons until ALL THREE reads settle — the one-shot
 * endorsements read included, since it is the only source of one of the three
 * sections. Every render assertion goes through here rather than firing the
 * moment the two snapshots land.
 */
async function settled() {
  await waitFor(() => expect(screen.queryByTestId('skeleton-card')).toBeNull());
}

/** Hold the endorsements read open; the returned function releases it. */
function holdEndorsements(): () => Promise<void> {
  let release!: () => void;
  h.referencesGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    h.referencesGate = null;
    release();
    await act(async () => {});
  };
}

/** Re-fire the focus refetch `useRefetchOnFocus` listens for. */
async function refocus() {
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.queries = [];
  h.getDocsCalls = [];
  h.offersNext = null;
  h.offersError = null;
  h.tasksNext = null;
  h.tasksError = null;
  h.referenceRows = [];
  h.referencesFail = false;
  h.referencesGate = null;
  h.auth.userDoc = { uid: 'd1', firstName: 'Lea' };
  h.auth.firebaseUser = { uid: 'd1' };
});

describe('doer dashboard — query shapes (nothing new reaches the server)', () => {
  it('reuses MyOffersPage and MyWorkPage shapes verbatim', () => {
    renderWithProviders(<DashboardPage />);
    const shapes = h.queries.map((q) => (q as { query: unknown[] }).query);
    const offersQuery = shapes.find((s) => (s[0] as { path: string }).path === 'taskOffers');
    const tasksQuery = shapes.find((s) => (s[0] as { path: string }).path === 'doTasks');

    expect(offersQuery).toEqual([
      { path: 'taskOffers' },
      { where: ['doerUserId', '==', 'd1'] },
      { orderBy: ['createdAt', 'desc'] },
    ]);
    // The `status in [...]` constraint is what routes this onto §7.3's
    // (assignedUserId, status, updatedAt) composite — a bare
    // assignedUserId + orderBy(updatedAt) has no index.
    expect(tasksQuery).toEqual([
      { path: 'doTasks' },
      { where: ['assignedUserId', '==', 'd1'] },
      { where: ['status', 'in', ['assigned', 'completed', 'cancelled']] },
      { orderBy: ['updatedAt', 'desc'] },
    ]);
  });

  it('reads endorsements with MyEndorsementsPage shape (the #300 recipient disjunct)', async () => {
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(h.getDocsCalls.length).toBeGreaterThan(0));
    expect((h.getDocsCalls[0] as { query: unknown[] }).query).toEqual([
      { path: 'references' },
      { where: ['doerUserId', '==', 'd1'] },
      { orderBy: ['createdAt', 'desc'] },
    ]);
  });
});

describe('doer dashboard — sections', () => {
  it('greets the student with the role blurb and the board quick action', async () => {
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([]);
    await settled();
    expect(screen.getByRole('heading', { name: /Hello, Lea/ })).toBeInTheDocument();
    expect(screen.getByText(/Find work, track your offers/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse the board' })).toBeInTheDocument();
  });

  it('splits live offers by who they are waiting on, and badges NEITHER as a to-do', async () => {
    renderWithProviders(<DashboardPage />);
    pushOffers([
      offerDoc('o1'),
      offerDoc('o2', { status: 'pending_guardian', taskTitle: 'Offer gated' }),
      offerDoc('o3', { status: 'declined', taskTitle: 'Offer dead' }),
    ]);
    pushTasks([]);
    await settled();

    expect(screen.getByText('Waiting for the family to decide.')).toBeInTheDocument();
    expect(screen.getByText('Waiting for your parent to approve it.')).toBeInTheDocument();
    // Terminal offers belong on /doer/offers, not on the landing page.
    expect(screen.queryByText('Offer dead')).toBeNull();
    // The section renders (total = 2) with NO badge: nothing here is ours to
    // answer, so the amber to-do count is zero.
    expect(screen.getByRole('button', { name: 'Your offers' })).toBeInTheDocument();
    // `pending` sorts above `pending_guardian`.
    const titles = screen.getAllByText(/^Offer (o1|gated)$/).map((el) => el.textContent);
    expect(titles).toEqual(['Offer o1', 'Offer gated']);
  });

  it('says what is next on assigned work, and drops finished assignments', async () => {
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([
      taskDoc('t1'),
      taskDoc('t2', { title: 'Task waiting', doerMarkedDoneAt: { toMillis: () => NOW } }),
      taskDoc('t3', { title: 'Task old', status: 'completed' }),
      taskDoc('t4', { title: 'Task gone', status: 'cancelled' }),
    ]);
    await settled();

    expect(screen.getByText('Mark it done when you finish')).toBeInTheDocument();
    expect(screen.getByText('Awaiting family confirmation')).toBeInTheDocument();
    expect(screen.queryByText('Task old')).toBeNull();
    expect(screen.queryByText('Task gone')).toBeNull();
    // Green section badges the row count.
    expect(screen.getByRole('button', { name: /^Assigned work\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Task t1/ })).toHaveAttribute(
      'href',
      '/doer/tasks/t1',
    );
  });

  it('counts endorsements awaiting an answer — the page’s one real to-do', async () => {
    h.referenceRows = [
      referenceDoc('r1'),
      referenceDoc('r2', { status: 'approved' }),
      // Shape filter (the MyEndorsementsPage rule): a foreign-app or
      // manual-type doc could only render as a row the server refuses.
      referenceDoc('r3', { appSource: 'study' }),
      referenceDoc('r4', { type: 'manual' }),
    ];
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([]);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Endorsements to answer\s*1$/ })).toBeInTheDocument(),
    );
    expect(screen.getByText('Family r1')).toBeInTheDocument();
    expect(screen.queryByText('Family r3')).toBeNull();
    expect(screen.queryByText('Family r4')).toBeNull();
    expect(screen.getByRole('link', { name: /Family r1/ })).toHaveAttribute(
      'href',
      '/doer/endorsements',
    );
  });

  // ── The empty state must never paint over a real to-do (PR #362 round 1).
  //    `hasAny` counts pending endorsements, but the endorsements read is
  //    one-shot: while it was outside the settled check and degraded to `[]`
  //    on failure, a student whose ONLY outstanding item was an endorsement
  //    saw "Nothing on the go" — permanently, if the read was denied. That is
  //    an affirmative false statement, the same shape as the defect PR #331
  //    round 2 fixed and the rule MyEndorsementsPage codifies. The two cases
  //    below are the ones the old failure test could not catch, because it
  //    pushed an offer first. ──
  it('never shows the empty state when an endorsement is the ONLY to-do', async () => {
    h.referenceRows = [referenceDoc('r1')];
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([]);

    // Both snapshots have landed and there is not a single offer or
    // assignment — the empty state must NOT paint while the endorsements read
    // is still in flight.
    expect(screen.queryByText(/Browse the board and offer to help/)).toBeNull();
    expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThan(0);

    await settled();
    expect(screen.getByRole('button', { name: /^Endorsements to answer\s*1$/ })).toBeInTheDocument();
    expect(screen.getByText('Family r1')).toBeInTheDocument();
    expect(screen.queryByText(/Browse the board and offer to help/)).toBeNull();
  });

  it('surfaces an error with a retry when the endorsements read fails — never an empty state', async () => {
    h.referencesFail = true;
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([]);
    await settled();

    expect(screen.getByText(/Could not check whether an endorsement is waiting/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // The reassuring lie this replaces.
    expect(screen.queryByText(/Browse the board and offer to help/)).toBeNull();
    // And it never renders as a silently absent section either.
    expect(screen.queryByRole('button', { name: /Endorsements to answer/ })).toBeNull();
  });

  it('keeps the daily loop rendered when only the endorsements read fails', async () => {
    h.referencesFail = true;
    renderWithProviders(<DashboardPage />);
    pushOffers([offerDoc('o1')]);
    pushTasks([]);
    await settled();
    expect(screen.getByText('Offer o1')).toBeInTheDocument();
    expect(screen.getByText(/Could not check whether an endorsement is waiting/)).toBeInTheDocument();
    // The page-level error line is for the two list reads, not this one.
    expect(screen.queryByText(/Could not load your dashboard/)).toBeNull();
  });

  // ── Round 2. Three states the round-1 specs could not reach: they all
  //    failed on FIRST load, with nothing rendered yet, so first-load and
  //    refetch behaviour were indistinguishable. ──
  it('keeps last-known-good rows through a focus-refetch failure', async () => {
    h.referenceRows = [referenceDoc('r1')];
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([]);
    await settled();
    expect(screen.getByText('Family r1')).toBeInTheDocument();

    // A transient failure on the REFETCH must not take the section away: the
    // reader is looking at a real to-do, and replacing it with an error hides
    // it — the softer form of the affirmative false statement this branch
    // exists to prevent. Study's dashboards state the rule as "a refetch blip
    // over rendered sections stays invisible".
    h.referencesFail = true;
    await refocus();

    expect(screen.getByText('Family r1')).toBeInTheDocument();
    expect(screen.queryByText(/Could not check whether an endorsement is waiting/)).toBeNull();
  });

  it('holds the retry inside its own section — the loaded sections never blank', async () => {
    h.referencesFail = true;
    renderWithProviders(<DashboardPage />);
    pushOffers([offerDoc('o1')]);
    pushTasks([taskDoc('t1')]);
    await settled();
    expect(screen.getByText(/Could not check whether an endorsement is waiting/)).toBeInTheDocument();

    h.referencesFail = false;
    h.referenceRows = [referenceDoc('r1')];
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    // SYNCHRONOUSLY after the click, with the re-read still in flight: the
    // offer and the assignment are still on screen. Reopening the PAGE-level
    // loading gate would have replaced both with skeletons.
    expect(screen.getByText('Offer o1')).toBeInTheDocument();
    expect(screen.getByText('Task t1')).toBeInTheDocument();
    expect(screen.queryByTestId('skeleton-card')).toBeNull();

    await waitFor(() => expect(screen.getByText('Family r1')).toBeInTheDocument());
  });

  it('waits for every read before calling the whole page a failure', async () => {
    const release = holdEndorsements();
    renderWithProviders(<DashboardPage />);
    // The offers listener errors and the tasks snapshot lands empty while the
    // one-shot endorsements read is still out. The page is LOADING, not
    // failed: "could not load your dashboard" is a verdict on a page that has
    // not finished loading.
    act(() => h.offersError!(new Error('denied')));
    pushTasks([]);
    expect(screen.queryByText(/Could not load your dashboard/)).toBeNull();
    expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThan(0);

    h.referenceRows = [referenceDoc('r1')];
    await release();
    expect(screen.getByText('Family r1')).toBeInTheDocument();
    expect(screen.queryByText(/Could not load your dashboard/)).toBeNull();
  });

  it('retries the endorsements read, and the section replaces the error', async () => {
    h.referencesFail = true;
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([]);
    await settled();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    h.referencesFail = false;
    h.referenceRows = [referenceDoc('r1')];
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText('Family r1')).toBeInTheDocument());
    expect(screen.queryByText(/Could not check whether an endorsement is waiting/)).toBeNull();
  });
});

describe('doer dashboard — empty, loading and error states', () => {
  it('points an empty dashboard at the board', async () => {
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([]);
    await settled();
    expect(screen.getByText(/Browse the board and offer to help/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse the board' })).toHaveAttribute(
      'href',
      '/doer/board',
    );
  });

  it('shows skeletons until ALL THREE reads settle, never the empty state', async () => {
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Browse the board and offer to help/)).toBeNull();

    pushTasks([]);
    // Both SNAPSHOTS are in, and the page is still loading: the one-shot
    // endorsements read has not resolved, and it is the only source of one of
    // the three sections (PR #362 round 1).
    expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThan(0);

    await settled();
    expect(screen.getByText(/Browse the board and offer to help/)).toBeInTheDocument();
  });

  it('renders the error line only when nothing at all could be read', async () => {
    renderWithProviders(<DashboardPage />);
    act(() => h.offersError!(new Error('denied')));
    act(() => h.tasksError!(new Error('denied')));
    await settled();
    expect(screen.getByText(/Could not load your dashboard/)).toBeInTheDocument();
  });

  it('renders the half that worked when only one read fails', async () => {
    renderWithProviders(<DashboardPage />);
    act(() => h.offersError!(new Error('denied')));
    pushTasks([taskDoc('t1')]);
    await settled();
    expect(screen.getByText('Task t1')).toBeInTheDocument();
    expect(screen.queryByText(/Could not load your dashboard/)).toBeNull();
  });
});

// ── A SUMMARY, NOT A SECOND LIST (the owner's redundancy report, applied to
//    both portals). Each section shows at most CAP rows and then names the
//    total on a link into the page that owns the rest. /doer/board is NOT
//    one of those pages and stays untouched: it is discovery across every
//    family's open tasks, not a longer copy of anything here. ──
const CAP = 5;

describe('doer dashboard — capped sections and their see-all', () => {
  it('shows at most five live offers and says how many there are', async () => {
    renderWithProviders(<DashboardPage />);
    pushOffers(Array.from({ length: 7 }, (_, i) => offerDoc(`o${i}`)));
    pushTasks([]);
    await settled();

    expect(screen.getByText('Offer o4')).toBeInTheDocument();
    expect(screen.queryByText('Offer o5')).toBeNull();
    expect(screen.queryByText('Offer o6')).toBeNull();
    expect(screen.getAllByText(/^Offer o\d$/)).toHaveLength(CAP);
    expect(screen.getByRole('link', { name: 'See all 7 offers' })).toHaveAttribute(
      'href',
      '/doer/offers',
    );
  });

  it('shows no see-all when every live offer already fits', async () => {
    renderWithProviders(<DashboardPage />);
    pushOffers(Array.from({ length: CAP }, (_, i) => offerDoc(`o${i}`)));
    pushTasks([]);
    await settled();

    expect(screen.getAllByText(/^Offer o\d$/)).toHaveLength(CAP);
    expect(screen.queryByRole('link', { name: /See all/ })).toBeNull();
  });

  it('caps assigned work and links its see-all to /doer/work', async () => {
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks(Array.from({ length: 6 }, (_, i) => taskDoc(`t${i}`)));
    await settled();

    expect(screen.getAllByText(/^Task t\d$/)).toHaveLength(CAP);
    expect(screen.queryByText('Task t5')).toBeNull();
    expect(screen.getByRole('link', { name: 'See all 6 assigned tasks' })).toHaveAttribute(
      'href',
      '/doer/work',
    );
    // Badge over the FULL set: five rows under a badge of six is the second
    // half of making the cap visible.
    expect(screen.getByRole('button', { name: /^Assigned work\s*6$/ })).toBeInTheDocument();
  });

  it('caps endorsements to answer and links its see-all to /doer/endorsements', async () => {
    h.referenceRows = Array.from({ length: 6 }, (_, i) => referenceDoc(`r${i}`));
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([]);
    await settled();

    expect(screen.getAllByText(/^Family r\d$/)).toHaveLength(CAP);
    expect(screen.queryByText('Family r5')).toBeNull();
    expect(screen.getByRole('link', { name: 'See all 6 endorsements' })).toHaveAttribute(
      'href',
      '/doer/endorsements',
    );
    expect(
      screen.getByRole('button', { name: /^Endorsements to answer\s*6$/ }),
    ).toBeInTheDocument();
  });

  it('counts each section separately — a busy page carries three see-alls', async () => {
    h.referenceRows = Array.from({ length: 8 }, (_, i) => referenceDoc(`r${i}`));
    renderWithProviders(<DashboardPage />);
    pushOffers(Array.from({ length: 6 }, (_, i) => offerDoc(`o${i}`)));
    pushTasks(Array.from({ length: 7 }, (_, i) => taskDoc(`t${i}`)));
    await settled();

    expect(screen.getByRole('link', { name: 'See all 6 offers' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all 7 assigned tasks' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all 8 endorsements' })).toBeInTheDocument();
  });

  it('never renders a see-all in place of the endorsements error state', async () => {
    // The error+retry block replaces the SECTION, so there is no row list to
    // cap and nothing to link — a failed read must not be summarised as if it
    // had returned rows (PR #362 round 1's rule, restated for the cap).
    h.referencesFail = true;
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([]);
    await settled();

    expect(screen.getByText(/Could not check whether an endorsement is waiting/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /See all/ })).toBeNull();
  });
});
