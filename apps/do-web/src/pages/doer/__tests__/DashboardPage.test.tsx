import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * The doer portal's landing DASHBOARD (§9.0's route table, issue #360).
 * The load-bearing pins:
 * - the three query shapes, argument for argument — they are MyOffersPage's,
 *   MyWorkPage's and MyEndorsementsPage's, so nothing new reaches the server
 *   and each stays provable under §7.2 / served by §7.3;
 * - the §6.2 `pending_guardian` split, and that neither live-offer state
 *   counts toward the amber TO-DO badge (both await someone else);
 * - the endorsement section's shape filter, and the board-pointing empty
 *   state.
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
    if (h.referencesFail) return Promise.reject(new Error('denied'));
    return Promise.resolve({
      docs: h.referenceRows.map((r, i) => ({ id: `r${i}`, data: () => r })),
    });
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
  it('greets the student with the role blurb and the board quick action', () => {
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([]);
    expect(screen.getByRole('heading', { name: /Hello, Lea/ })).toBeInTheDocument();
    expect(screen.getByText(/Find work, track your offers/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse the board' })).toBeInTheDocument();
  });

  it('splits live offers by who they are waiting on, and badges NEITHER as a to-do', () => {
    renderWithProviders(<DashboardPage />);
    pushOffers([
      offerDoc('o1'),
      offerDoc('o2', { status: 'pending_guardian', taskTitle: 'Offer gated' }),
      offerDoc('o3', { status: 'declined', taskTitle: 'Offer dead' }),
    ]);
    pushTasks([]);

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

  it('says what is next on assigned work, and drops finished assignments', () => {
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([
      taskDoc('t1'),
      taskDoc('t2', { title: 'Task waiting', doerMarkedDoneAt: { toMillis: () => NOW } }),
      taskDoc('t3', { title: 'Task old', status: 'completed' }),
      taskDoc('t4', { title: 'Task gone', status: 'cancelled' }),
    ]);

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

  it('keeps the daily loop when the endorsements read fails', async () => {
    h.referencesFail = true;
    renderWithProviders(<DashboardPage />);
    pushOffers([offerDoc('o1')]);
    pushTasks([]);
    await waitFor(() => expect(screen.getByText('Offer o1')).toBeInTheDocument());
    expect(screen.queryByText('Endorsements to answer')).toBeNull();
  });
});

describe('doer dashboard — empty, loading and error states', () => {
  it('points an empty dashboard at the board', () => {
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    pushTasks([]);
    expect(screen.getByText(/Browse the board and offer to help/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse the board' })).toHaveAttribute(
      'href',
      '/doer/board',
    );
  });

  it('shows skeletons until BOTH snapshots settle, never the empty state', () => {
    renderWithProviders(<DashboardPage />);
    pushOffers([]);
    expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Browse the board and offer to help/)).toBeNull();
    pushTasks([]);
    expect(screen.queryByTestId('skeleton-card')).toBeNull();
  });

  it('renders the error line only when nothing at all could be read', () => {
    renderWithProviders(<DashboardPage />);
    act(() => h.offersError!(new Error('denied')));
    act(() => h.tasksError!(new Error('denied')));
    expect(screen.getByText(/Could not load your dashboard/)).toBeInTheDocument();
  });

  it('renders the half that worked when only one read fails', () => {
    renderWithProviders(<DashboardPage />);
    act(() => h.offersError!(new Error('denied')));
    pushTasks([taskDoc('t1')]);
    expect(screen.getByText('Task t1')).toBeInTheDocument();
    expect(screen.queryByText(/Could not load your dashboard/)).toBeNull();
  });
});
