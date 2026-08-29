import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * The board (plan §9.2 / §7.3). The load-bearing pins:
 * - SERVER filters are status + category ONLY — §7.3's split is the spec.
 *   The area/timing/adult/transport/sub-category filters must NEVER reach
 *   the query (each un-indexed combination is a silent 400 in prod).
 * - Client-side narrowing over the fetched page, including expiry (§6.1:
 *   expiry is not a status).
 * - Card field discipline (§11.2): board-visible fields only — a task doc
 *   poisoned with address/latLng/offerCount must not leak into the DOM.
 */

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

const h = vi.hoisted(() => ({
  calls: [] as unknown[][],
  docsQueue: [] as unknown[][],
  // When set, the NEXT getDocs awaits this instead of the queue — lets a test
  // hold a fetch open and inspect the in-flight window.
  pending: null as Promise<unknown[]> | null,
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
// CardThumb's signed-URL callable: never resolves — thumbnails are
// irrelevant to these pins.
vi.mock('firebase/functions', () => ({ httpsCallable: () => () => new Promise(() => {}) }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  limit: (n: number) => ({ limit: n }),
  startAfter: (cursor: unknown) => ({ startAfter: cursor }),
  getDocs: (q: { query: unknown[] }) => {
    h.calls.push(q.query);
    if (h.pending) {
      const held = h.pending;
      h.pending = null;
      return held.then((docs) => ({ docs }));
    }
    return Promise.resolve({ docs: h.docsQueue.shift() ?? [] });
  },
}));

import { BoardPage, BOARD_PAGE_SIZE } from '../BoardPage';

type Row = Record<string, unknown>;
function taskDoc(id: string, overrides: Row = {}): Row {
  return {
    taskId: id,
    familyId: 'famX',
    familyName: 'Martin',
    areaLabel: '15e',
    title: `Task ${id}`,
    category: 'ikea',
    subCategory: 'ikea_assembly',
    description: 'assemble things',
    photos: [],
    timing: 'deadline',
    dueDate: '2026-09-15',
    status: 'open',
    adultPresent: 'yes',
    transportNeeded: false,
    suggestedBudget: null,
    estimatedHours: null,
    // POISON: none of these may ever render on a board card (§11.2 / §4.1).
    address: '12 rue des Peupliers',
    latLng: { lat: 48.8, lng: 2.35 },
    offerCount: 77,
    createdAt: { toMillis: () => NOW - 1000 },
    expiresAt: { toMillis: () => NOW + DAY_MS },
    ...overrides,
  };
}

const asDocs = (rows: Row[]) => rows.map((r) => ({ id: r.taskId as string, data: () => r }));

beforeEach(() => {
  h.calls = [];
  h.docsQueue = [];
  h.pending = null;
});

describe('BoardPage query shape (§7.3 pins)', () => {
  it('issues EXACTLY status==open + createdAt desc + limit when no category is picked', async () => {
    h.docsQueue.push(asDocs([taskDoc('t1')]));
    renderWithProviders(<BoardPage />);
    await screen.findByText('Task t1');

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toEqual([
      { path: 'doTasks' },
      { where: ['status', '==', 'open'] },
      { orderBy: ['createdAt', 'desc'] },
      { limit: BOARD_PAGE_SIZE },
    ]);
  });

  it('adds ONLY where(category==...) when a category is picked', async () => {
    h.docsQueue.push(asDocs([taskDoc('t1')]));
    renderWithProviders(<BoardPage />);
    await screen.findByText('Task t1');

    h.docsQueue.push(asDocs([taskDoc('t2')]));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'ikea' } });
    await screen.findByText('Task t2');

    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toEqual([
      { path: 'doTasks' },
      { where: ['status', '==', 'open'] },
      { where: ['category', '==', 'ikea'] },
      { orderBy: ['createdAt', 'desc'] },
      { limit: BOARD_PAGE_SIZE },
    ]);
  });

  it('the OTHER filters never reach the query — no new getDocs, no new where (the silent-400 pin)', async () => {
    h.docsQueue.push(
      asDocs([
        taskDoc('t1'),
        taskDoc('t2', { subCategory: 'ikea_wall_mounting', timing: 'ongoing', startDate: '2026-09-01', areaLabel: '7e', adultPresent: 'no', transportNeeded: true }),
      ]),
    );
    renderWithProviders(<BoardPage />);
    await screen.findByText('Task t1');
    const callsAfterLoad = h.calls.length;

    fireEvent.change(screen.getByLabelText('Timing'), { target: { value: 'ongoing' } });
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: '7e' } });
    fireEvent.change(screen.getByLabelText('Adult present'), { target: { value: 'no' } });
    fireEvent.change(screen.getByLabelText('Car or bike needed'), { target: { value: 'yes' } });
    await screen.findByText('Task t2');

    // Client-side narrowing happened...
    expect(screen.queryByText('Task t1')).toBeNull();
    // ...and the server never heard about any of it.
    expect(h.calls).toHaveLength(callsAfterLoad);
    for (const call of h.calls) {
      const wheres = call.filter((c) => (c as { where?: unknown[] }).where).map((c) => (c as { where: unknown[] }).where[0]);
      expect(wheres.every((field) => field === 'status' || field === 'category')).toBe(true);
    }
  });
});

describe('BoardPage client-side narrowing (§7.3 split)', () => {
  it('narrows by sub-category over the fetched page', async () => {
    h.docsQueue.push(
      asDocs([taskDoc('t1'), taskDoc('t2', { subCategory: 'ikea_wall_mounting' })]),
    );
    renderWithProviders(<BoardPage />);
    await screen.findByText('Task t1');

    // Sub-category select unlocks with the category (it is category-scoped).
    h.docsQueue.push(asDocs([taskDoc('t1'), taskDoc('t2', { subCategory: 'ikea_wall_mounting' })]));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'ikea' } });
    await screen.findByText('Task t2');
    fireEvent.change(screen.getByLabelText('Sub-category'), { target: { value: 'ikea_wall_mounting' } });

    await waitFor(() => expect(screen.queryByText('Task t1')).toBeNull());
    expect(screen.getByText('Task t2')).toBeInTheDocument();
  });

  it('filters expired-but-unswept tasks client-side (§6.1: expiry is not a status)', async () => {
    h.docsQueue.push(
      asDocs([taskDoc('live'), taskDoc('stale', { expiresAt: { toMillis: () => NOW - DAY_MS } })]),
    );
    renderWithProviders(<BoardPage />);
    await screen.findByText('Task live');
    expect(screen.queryByText('Task stale')).toBeNull();
  });
});

describe('BoardPage category-switch staleness', () => {
  // Deriving the spinner from `loadedCategory` (rather than blanking `tasks`)
  // must gate "Load more" as well: mid-switch the cursor is already reset, so
  // a click there would page the NEW category and append it to the OLD rows.
  it('hides Load more while a category switch is in flight, and never mixes categories', async () => {
    // A FULL first page ⇒ not exhausted ⇒ Load more is on screen.
    h.docsQueue.push(asDocs(Array.from({ length: BOARD_PAGE_SIZE }, (_, i) => taskDoc(`a${i}`))));
    renderWithProviders(<BoardPage />);
    await screen.findByText('Task a0');
    expect(screen.getByText('Load more')).toBeInTheDocument();

    // Switch category, holding the new page open.
    let release!: (docs: unknown[]) => void;
    h.pending = new Promise<unknown[]>((res) => {
      release = res;
    });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'boxes' } });

    // Mid-switch: Load more is GONE (the regression pin).
    await waitFor(() => expect(screen.queryByText('Load more')).toBeNull());

    release(asDocs([taskDoc('b0', { category: 'boxes' })]));
    await screen.findByText('Task b0');
    // The old category's rows are replaced, never appended to.
    expect(screen.queryByText('Task a0')).toBeNull();
  });
});

describe('BoardPage card field discipline (§11.2)', () => {
  it('shows areaLabel + familyName and the adult-present badge', async () => {
    h.docsQueue.push(asDocs([taskDoc('t1', { transportNeeded: true, suggestedBudget: 40 })]));
    renderWithProviders(<BoardPage />);
    await screen.findByText('Task t1');
    expect(screen.getByText(/15e · Martin/)).toBeInTheDocument();
    // 'Adult present' appears once as the filter's label and once as the
    // card badge — the second occurrence is the §9.2 badge under test.
    expect(screen.getAllByText('Adult present')).toHaveLength(2);
    expect(screen.getByText('Car or bike')).toBeInTheDocument();
    expect(screen.getByText('Suggested: 40 €')).toBeInTheDocument();
  });

  it('NEVER renders address, latLng or offerCount, even when poisoned onto the doc', async () => {
    h.docsQueue.push(asDocs([taskDoc('t1')]));
    const { container } = renderWithProviders(<BoardPage />);
    await screen.findByText('Task t1');
    expect(container.innerHTML).not.toContain('12 rue des Peupliers');
    expect(container.innerHTML).not.toContain('48.8');
    expect(container.innerHTML).not.toContain('77');
  });
});

describe('BoardPage pagination', () => {
  it('pages with startAfter behind a full page, keeping the same server shape', async () => {
    const fullPage = Array.from({ length: BOARD_PAGE_SIZE }, (_, i) => taskDoc(`p${i}`));
    h.docsQueue.push(asDocs(fullPage));
    renderWithProviders(<BoardPage />);
    await screen.findByText('Task p0');

    h.docsQueue.push(asDocs([taskDoc('next')]));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Task next');

    const second = h.calls[1];
    expect(second).toContainEqual({ where: ['status', '==', 'open'] });
    expect(second.some((c) => (c as { startAfter?: unknown }).startAfter !== undefined)).toBe(true);
    // Previous page stays on screen (append, not replace).
    expect(screen.getByText('Task p0')).toBeInTheDocument();
  });
});
