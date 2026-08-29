import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * The family portal's landing DASHBOARD (§9.0's route table, issue #360).
 * The load-bearing pins:
 * - the four query shapes, argument for argument — nothing new reaches the
 *   server, so each one must stay the shape the app already proves under
 *   §7.2 and serves from §7.3's composites;
 * - `offerCount` is NEVER rendered (§4.1 "BOUND-FACING ONLY") — the badge is
 *   grouped from the family's own pending-offer list, exactly as on the list
 *   page this dashboard now sits in front of;
 * - the three sections, the endorsement prompt's gate, and the empty state's
 *   route into posting.
 */

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  queries: [] as unknown[],
  getDocsCalls: [] as unknown[],
  tasksNext: null as null | ((snap: unknown) => void),
  tasksError: null as null | ((err: unknown) => void),
  offersNext: null as null | ((snap: unknown) => void),
  /** Rows the `references` getDocs resolves with, or a rejection. */
  referenceRows: [] as Record<string, unknown>[],
  referencesFail: false,
  referencesGate: null as Promise<void> | null,
  familyDoc: { familyName: 'Dupont' } as Record<string, unknown> | null,
  unsub: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ docPath: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  getDoc: () =>
    Promise.resolve({
      exists: () => h.familyDoc !== null,
      data: () => h.familyDoc,
    }),
  getDocs: (q: unknown) => {
    h.getDocsCalls.push(q);
    const settle = () =>
      h.referencesFail
        ? Promise.reject(new Error('denied'))
        : Promise.resolve({
            docs: h.referenceRows.map((r, i) => ({ id: `r${i}`, data: () => r })),
          });
    // `referencesGate` holds the one-shot read open, so a test can observe the
    // page WHILE the endorsement gate is in flight.
    return h.referencesGate ? h.referencesGate.then(settle) : settle();
  },
  onSnapshot: (q: unknown, next: (snap: unknown) => void, error: (err: unknown) => void) => {
    h.queries.push(q);
    const path = (q as { query?: { path?: string }[] }).query?.[0]?.path;
    if (path === 'doTasks') {
      h.tasksNext = next;
      h.tasksError = error;
    } else if (path === 'taskOffers') {
      h.offersNext = next;
    }
    return h.unsub;
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { DashboardPage } from '../DashboardPage';

type Row = Record<string, unknown>;
function taskDoc(id: string, overrides: Row = {}): Row {
  return {
    taskId: id,
    familyId: 'fam1',
    title: `Task ${id}`,
    category: 'ikea',
    timing: 'deadline',
    dueDate: '2026-09-15',
    status: 'open',
    offerCount: 99, // poison: rendering this number anywhere is the bug
    assignedUserId: null,
    doerMarkedDoneAt: null,
    completedAt: null,
    createdAt: { toMillis: () => NOW - 1000 },
    expiresAt: { toMillis: () => NOW + DAY_MS },
    ...overrides,
  };
}

function pushTasks(rows: Row[]) {
  act(() => h.tasksNext!({ docs: rows.map((r) => ({ id: r.taskId as string, data: () => r })) }));
}
function pushOffers(rows: Row[]) {
  act(() => h.offersNext!({ docs: rows.map((r, i) => ({ id: `o${i}`, data: () => r })) }));
}

/**
 * The page holds skeletons until BOTH reads that feed a rendered row settle —
 * the tasks snapshot and the one-shot endorsement gate (PR #362 round 2), so
 * a completed row is never badged before the gate can say what it should say.
 * Every render assertion goes through here.
 */
async function settled() {
  await waitFor(() => expect(screen.queryByTestId('skeleton-card')).toBeNull());
}

/** Hold the endorsement gate's read open; the returned function releases it. */
function holdEndorsed(): () => Promise<void> {
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

beforeEach(() => {
  vi.clearAllMocks();
  h.queries = [];
  h.getDocsCalls = [];
  h.tasksNext = null;
  h.tasksError = null;
  h.offersNext = null;
  h.referenceRows = [];
  h.referencesFail = false;
  h.referencesGate = null;
  h.familyDoc = { familyName: 'Dupont' };
  h.auth.userDoc = { uid: 'p1', firstName: 'Marie', profiles: { parent: { familyId: 'fam1' } } };
});

describe('family dashboard — query shapes (nothing new reaches the server)', () => {
  it('issues the two live queries with exactly the shapes the list page proves', () => {
    renderWithProviders(<DashboardPage />);
    const shapes = h.queries.map((q) => (q as { query: unknown[] }).query);
    const tasksQuery = shapes.find((s) => (s[0] as { path: string }).path === 'doTasks');
    const offersQuery = shapes.find((s) => (s[0] as { path: string }).path === 'taskOffers');

    expect(tasksQuery).toEqual([
      { path: 'doTasks' },
      { where: ['familyId', '==', 'fam1'] },
      { orderBy: ['createdAt', 'desc'] },
    ]);
    // §9.1's ONE list-wide badge query: no taskId constraint anywhere.
    expect(offersQuery).toEqual([
      { path: 'taskOffers' },
      { where: ['familyId', '==', 'fam1'] },
      { where: ['status', '==', 'pending'] },
      { orderBy: ['createdAt'] },
    ]);
    expect(shapes.filter((s) => (s[0] as { path: string }).path === 'taskOffers')).toHaveLength(1);
  });

  it('gates the endorsement prompt on an EQUALITY-ONLY references query (no composite)', async () => {
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(h.getDocsCalls.length).toBeGreaterThan(0));
    const refsQuery = (h.getDocsCalls[0] as { query: unknown[] }).query;
    expect(refsQuery).toEqual([
      { path: 'references' },
      { where: ['submittedByFamilyId', '==', 'fam1'] },
      { where: ['appSource', '==', 'do'] },
    ]);
    // No orderBy: two equalities alone need no composite index, and the page
    // only wants the set of doer ids.
    expect(refsQuery.some((part) => 'orderBy' in (part as object))).toBe(false);
  });
});

describe('family dashboard — sections', () => {
  it('greets the parent with the family context line', async () => {
    renderWithProviders(<DashboardPage />);
    pushTasks([]);
    await settled();
    expect(screen.getByRole('heading', { name: /Hello, Marie/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('DUPONT family')).toBeInTheDocument());
  });

  it('badges open tasks from the grouped offer list, NEVER from offerCount', async () => {
    renderWithProviders(<DashboardPage />);
    pushTasks([taskDoc('t1'), taskDoc('t2')]);
    pushOffers([{ taskId: 't1' }, { taskId: 't1' }]);
    await settled();

    expect(screen.getByText('Your open tasks')).toBeInTheDocument();
    expect(screen.getByText('2 offers')).toBeInTheDocument();
    expect(screen.getByText('No offers yet')).toBeInTheDocument();
    expect(screen.queryByText(/99/)).toBeNull();
    // The amber section badge is the TO-DO count: open tasks WITH offers.
    expect(screen.getByRole('button', { name: /^Your open tasks\s*1$/ })).toBeInTheDocument();
  });

  it('drops an EXPIRED open task — it can no longer be acted on', async () => {
    renderWithProviders(<DashboardPage />);
    pushTasks([
      taskDoc('t1', { expiresAt: { toMillis: () => NOW - 1000 }, title: 'Task stale' }),
      taskDoc('t2', { title: 'Task live' }),
    ]);
    pushOffers([]);
    await settled();
    expect(screen.getByText('Task live')).toBeInTheDocument();
    expect(screen.queryByText('Task stale')).toBeNull();
  });

  it('orders open tasks soonest-to-expire first', async () => {
    renderWithProviders(<DashboardPage />);
    pushTasks([
      taskDoc('t1', { title: 'Task later', expiresAt: { toMillis: () => NOW + 5 * DAY_MS } }),
      taskDoc('t2', { title: 'Task sooner', expiresAt: { toMillis: () => NOW + DAY_MS } }),
    ]);
    pushOffers([]);
    await settled();
    const titles = screen.getAllByText(/^Task (later|sooner)$/).map((el) => el.textContent);
    expect(titles).toEqual(['Task sooner', 'Task later']);
  });

  it('separates in-progress work and flags one the student marked done', async () => {
    renderWithProviders(<DashboardPage />);
    pushTasks([
      taskDoc('t1', { status: 'assigned', title: 'Task running', assignedUserId: 'd1' }),
      taskDoc('t2', {
        status: 'assigned',
        title: 'Task waiting',
        assignedUserId: 'd2',
        doerMarkedDoneAt: { toMillis: () => NOW },
      }),
    ]);
    pushOffers([]);
    await settled();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Marked done by the student')).toBeInTheDocument();
    expect(screen.getByText('Assigned')).toBeInTheDocument();
  });

  it('prompts for an endorsement only on completions this family has not endorsed', async () => {
    h.referenceRows = [{ doerUserId: 'd2', appSource: 'do' }];
    renderWithProviders(<DashboardPage />);
    pushTasks([
      taskDoc('t1', {
        status: 'completed',
        title: 'Task unendorsed',
        assignedUserId: 'd1',
        completedAt: { toMillis: () => NOW },
      }),
      taskDoc('t2', {
        status: 'completed',
        title: 'Task endorsed',
        assignedUserId: 'd2',
        completedAt: { toMillis: () => NOW - 1000 },
      }),
    ]);
    pushOffers([]);
    await waitFor(() => expect(screen.getByText('Say how it went')).toBeInTheDocument());
    expect(screen.getByText('Completed')).toBeInTheDocument();
    // The prompt is on the row whose doer has no endorsement from us.
    const prompted = screen.getByText('Say how it went').closest('a');
    expect(prompted).toHaveAttribute('href', '/family/tasks/t1');
  });

  // ── Round 2: the gate is a READ, and a completion must not be badged
  //    "endorse me" before it resolves — the prompt would then retract
  //    itself on every already-endorsed row. The doer page applies the same
  //    settled-check discipline to its own one-shot read. ──
  it('does not prompt before the endorsement gate resolves', async () => {
    const release = holdEndorsed();
    h.referenceRows = [{ doerUserId: 'd1', appSource: 'do' }];
    renderWithProviders(<DashboardPage />);
    pushTasks([
      taskDoc('t1', {
        status: 'completed',
        title: 'Task endorsed',
        assignedUserId: 'd1',
        completedAt: { toMillis: () => NOW },
      }),
    ]);
    pushOffers([]);

    // The tasks snapshot has landed, but the gate has not: an amber "Say how
    // it went" here would be retracted a moment later on a task this family
    // HAS endorsed.
    expect(screen.queryByText('Say how it went')).toBeNull();

    await release();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.queryByText('Say how it went')).toBeNull();
  });

  it('still prompts when the references read fails — the callable is the real gate', async () => {
    h.referencesFail = true;
    renderWithProviders(<DashboardPage />);
    pushTasks([
      taskDoc('t1', {
        status: 'completed',
        title: 'Task done',
        assignedUserId: 'd1',
        completedAt: { toMillis: () => NOW },
      }),
    ]);
    pushOffers([]);
    await waitFor(() => expect(screen.getByText('Say how it went')).toBeInTheDocument());
  });

  it('caps the completions it keeps, newest first', async () => {
    renderWithProviders(<DashboardPage />);
    pushTasks(
      Array.from({ length: 7 }, (_, i) =>
        taskDoc(`t${i}`, {
          status: 'completed',
          title: `Task ${i}`,
          assignedUserId: 'd1',
          completedAt: { toMillis: () => NOW - i * 1000 },
        }),
      ),
    );
    pushOffers([]);
    await settled();
    expect(screen.getByText('Task 0')).toBeInTheDocument();
    expect(screen.getByText('Task 4')).toBeInTheDocument();
    expect(screen.queryByText('Task 5')).toBeNull();
    expect(screen.queryByText('Task 6')).toBeNull();
  });

  it('links every row to the task detail, where the actions live', async () => {
    renderWithProviders(<DashboardPage />);
    pushTasks([taskDoc('t1')]);
    pushOffers([]);
    await settled();
    expect(screen.getByRole('link', { name: /Task t1/ })).toHaveAttribute(
      'href',
      '/family/tasks/t1',
    );
  });
});

describe('family dashboard — empty, loading and error states', () => {
  it('offers the post CTA in the header and again in the empty state', async () => {
    renderWithProviders(<DashboardPage />);
    pushTasks([]);
    await settled();
    expect(screen.getByRole('button', { name: 'Post a task' })).toBeInTheDocument();
    expect(screen.getByText(/Post a task and EJM students will offer to help/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Post a task' })).toHaveAttribute(
      'href',
      '/family/post',
    );
  });

  it('shows skeletons until BOTH reads settle, never the empty state', async () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThan(0);
    expect(screen.queryByText(/EJM students will offer to help/)).toBeNull();

    pushTasks([]);
    // The tasks snapshot is in and the endorsement gate is not: still
    // loading, because the gate decides what a completed row says.
    expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThan(0);

    await settled();
    expect(screen.getByText(/EJM students will offer to help/)).toBeInTheDocument();
  });

  it('renders the error line when the tasks read fails with nothing loaded', async () => {
    renderWithProviders(<DashboardPage />);
    act(() => h.tasksError!(new Error('denied')));
    await settled();
    expect(screen.getByText(/Could not load your tasks/)).toBeInTheDocument();
  });
});
