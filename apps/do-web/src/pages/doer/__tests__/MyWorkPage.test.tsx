import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * My tasks / assigned work (plan §9.2). The pin: the one query is
 * where(assignedUserId==uid) + status in [assigned,completed,cancelled] +
 * orderBy(updatedAt desc) — provable under §7.2's own-assignment disjunct
 * and shaped for §7.3's (assignedUserId, status, updatedAt) composite;
 * tabs narrow client-side.
 */

const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 'd1' } as unknown },
  queries: [] as unknown[][],
  next: null as null | ((snap: unknown) => void),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  onSnapshot: (q: unknown, next: (snap: unknown) => void) => {
    h.queries.push((q as { query: unknown[] }).query);
    h.next = next;
    return vi.fn();
  },
}));

import { MyWorkPage } from '../MyWorkPage';

type Row = Record<string, unknown>;
function task(id: string, status: string, overrides: Row = {}): Row {
  return {
    taskId: id,
    title: `Task ${id}`,
    category: 'green_thumb',
    timing: 'ongoing',
    startDate: '2026-09-01',
    areaLabel: '15e',
    status,
    assignedUserId: 'd1',
    agreedPrice: 30,
    doerMarkedDoneAt: null,
    updatedAt: { toMillis: () => 1 },
    ...overrides,
  };
}

function push(rows: Row[]) {
  act(() => h.next!({ docs: rows.map((r) => ({ id: r.taskId as string, data: () => r })) }));
}

beforeEach(() => {
  h.queries = [];
  h.next = null;
  h.auth = { firebaseUser: { uid: 'd1' } };
});

describe('MyWorkPage query shape (§7.3 pin)', () => {
  it('issues the assignment-composite query exactly', () => {
    renderWithProviders(<MyWorkPage />);
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0]).toEqual([
      { path: 'doTasks' },
      { where: ['assignedUserId', '==', 'd1'] },
      { where: ['status', 'in', ['assigned', 'completed', 'cancelled']] },
      { orderBy: ['updatedAt', 'desc'] },
    ]);
  });
});

describe('MyWorkPage tabs and badges', () => {
  it('narrows the three tabs client-side from the one list', () => {
    renderWithProviders(<MyWorkPage />);
    push([task('a1', 'assigned'), task('c1', 'completed'), task('x1', 'cancelled')]);

    expect(screen.getByText('Task a1')).toBeInTheDocument();
    expect(screen.queryByText('Task c1')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Completed' }));
    expect(screen.getByText('Task c1')).toBeInTheDocument();

    // The cancelled tab exists so §6.4's aftermath grace stays reachable.
    fireEvent.click(screen.getByRole('tab', { name: 'Cancelled' }));
    expect(screen.getByText('Task x1')).toBeInTheDocument();
  });

  it('badges the awaiting-family state once the doer marked done, and links into the task', () => {
    renderWithProviders(<MyWorkPage />);
    push([task('a1', 'assigned', { doerMarkedDoneAt: { toMillis: () => 5 } })]);
    expect(screen.getByText('Awaiting family confirmation')).toBeInTheDocument();
    expect(screen.getByText('Task a1').closest('a')).toHaveAttribute('href', '/doer/tasks/a1');
    expect(screen.getByText('30 € agreed')).toBeInTheDocument();
  });
});
