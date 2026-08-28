import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * My-tasks list (plan §9.1). The load-bearing pins:
 * - THE badge query shape: ONE list-wide taskOffers query —
 *   where(familyId==f) + where(status=='pending') + orderBy(createdAt) —
 *   grouped client-side by taskId. Never per-task, never `offerCount`
 *   (which counts pending_guardian offers the family cannot see, §4.1).
 * - The tasks query: where(familyId==f) + orderBy(createdAt desc).
 * - Tabs filter the one list client-side; open cards badge counts/expiry.
 */

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  queries: [] as unknown[],
  tasksNext: null as null | ((snap: unknown) => void),
  tasksError: null as null | ((err: unknown) => void),
  offersNext: null as null | ((snap: unknown) => void),
  unsub: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
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

import { MyTasksPage } from '../MyTasksPage';

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
    doerMarkedDoneAt: null,
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

beforeEach(() => {
  vi.clearAllMocks();
  h.queries = [];
  h.tasksNext = null;
  h.tasksError = null;
  h.offersNext = null;
  h.auth.userDoc = { uid: 'p1', profiles: { parent: { familyId: 'fam1' } } };
});

describe('MyTasksPage queries (shape pins)', () => {
  it('issues the two §9.1 queries with exactly the stated shapes', () => {
    renderWithProviders(<MyTasksPage />);
    const shapes = h.queries.map((q) => (q as { query: unknown[] }).query);
    const tasksQuery = shapes.find((s) => (s[0] as { path: string }).path === 'doTasks');
    const offersQuery = shapes.find((s) => (s[0] as { path: string }).path === 'taskOffers');

    expect(tasksQuery).toEqual([
      { path: 'doTasks' },
      { where: ['familyId', '==', 'fam1'] },
      { orderBy: ['createdAt', 'desc'] },
    ]);
    // THE load-bearing badge shape: one LIST-WIDE query (no taskId
    // constraint anywhere), status equality on 'pending', createdAt order —
    // provable under §7.2's family disjunct, served by the
    // (familyId, status, createdAt) composite.
    expect(offersQuery).toEqual([
      { path: 'taskOffers' },
      { where: ['familyId', '==', 'fam1'] },
      { where: ['status', '==', 'pending'] },
      { orderBy: ['createdAt'] },
    ]);
    // And it is ONE offers query, not one per task.
    expect(shapes.filter((s) => (s[0] as { path: string }).path === 'taskOffers')).toHaveLength(1);
  });
});

describe('MyTasksPage badges and tabs', () => {
  it('badges open tasks from the grouped offer list, NEVER from offerCount', () => {
    renderWithProviders(<MyTasksPage />);
    pushTasks([taskDoc('t1'), taskDoc('t2')]);
    pushOffers([{ taskId: 't1' }, { taskId: 't1' }]);

    expect(screen.getByText('2 offers')).toBeInTheDocument();
    expect(screen.getByText('No offers yet')).toBeInTheDocument();
    // The poison value from the doc's offerCount field must never render.
    expect(screen.queryByText(/99/)).toBeNull();
  });

  it('shows the expired badge instead of an offer count for an expired open task', () => {
    renderWithProviders(<MyTasksPage />);
    pushTasks([taskDoc('t1', { expiresAt: { toMillis: () => NOW - 1000 } })]);
    pushOffers([{ taskId: 't1' }]);
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('1 offer')).toBeNull();
  });

  it('filters the one list into the four status tabs client-side', () => {
    renderWithProviders(<MyTasksPage />);
    pushTasks([
      taskDoc('t1'),
      taskDoc('t2', { status: 'assigned', title: 'Task assigned' }),
      taskDoc('t3', { status: 'completed', title: 'Task done' }),
      taskDoc('t4', { status: 'cancelled', title: 'Task gone' }),
    ]);
    pushOffers([]);

    expect(screen.getByText('Task t1')).toBeInTheDocument();
    expect(screen.queryByText('Task assigned')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Assigned' }));
    expect(screen.getByText('Task assigned')).toBeInTheDocument();
    expect(screen.queryByText('Task t1')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Completed' }));
    expect(screen.getByText('Task done')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Cancelled' }));
    expect(screen.getByText('Task gone')).toBeInTheDocument();
  });

  it('flags an assigned task the student already marked done', () => {
    renderWithProviders(<MyTasksPage />);
    pushTasks([
      taskDoc('t1', { status: 'assigned', doerMarkedDoneAt: { toMillis: () => NOW } }),
    ]);
    pushOffers([]);
    fireEvent.click(screen.getByRole('tab', { name: 'Assigned' }));
    expect(screen.getByText('Marked done by the student')).toBeInTheDocument();
  });

  it('renders the empty state with the post CTA, and the error copy on a failed read', () => {
    renderWithProviders(<MyTasksPage />);
    pushTasks([]);
    expect(screen.getByText(/No open tasks/)).toBeInTheDocument();

    act(() => h.tasksError!(new Error('denied')));
    expect(screen.getByText(/Could not load your tasks/)).toBeInTheDocument();
  });

  it('links each card to its task detail route', () => {
    renderWithProviders(<MyTasksPage />);
    pushTasks([taskDoc('t1')]);
    pushOffers([]);
    expect(screen.getByRole('link', { name: /Task t1/ })).toHaveAttribute(
      'href',
      '/family/tasks/t1',
    );
  });
});
