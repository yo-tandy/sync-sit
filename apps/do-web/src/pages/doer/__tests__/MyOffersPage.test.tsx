import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * My offers (plan §9.2). The load-bearing pins:
 * - ONE query: where(doerUserId==uid) + orderBy(createdAt desc) — §7.3's
 *   (doerUserId, createdAt) composite; the status tabs narrow
 *   CLIENT-SIDE (the index note), so no status where may ever appear.
 * - §4.2's terminal fallback: a dead offer renders its summary line from
 *   the denormalized taskTitle/Category/Timing with NO task read and NO
 *   link — the page must never touch doTasks at all.
 */

const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 'd1' } as unknown },
  queries: [] as unknown[][],
  collections: [] as string[],
  next: null as null | ((snap: unknown) => void),
  callables: [] as { name: string; payload: unknown }[],
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => (payload: unknown) => {
    h.callables.push({ name, payload });
    return Promise.resolve({ data: {} });
  },
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => {
    h.collections.push(path.join('/'));
    return { path: path.join('/') };
  },
  doc: (_db: unknown, ...path: string[]) => {
    h.collections.push(path[0]);
    return { path: path.join('/') };
  },
  getDoc: () => {
    throw new Error('MyOffersPage must never read a document directly');
  },
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  onSnapshot: (q: unknown, next: (snap: unknown) => void) => {
    h.queries.push((q as { query: unknown[] }).query);
    h.next = next;
    return vi.fn();
  },
}));

import { MyOffersPage } from '../MyOffersPage';

type Row = Record<string, unknown>;
function offer(id: string, status: string, overrides: Row = {}): Row {
  return {
    offerId: id,
    taskId: `task-${id}`,
    doerUserId: 'd1',
    status,
    // §4.2's denormalized fallback — the ONLY task facts the card may use.
    taskTitle: `Title ${id}`,
    taskCategory: 'boxes',
    taskTiming: 'deadline',
    price: 25,
    priceBasis: 'flat',
    message: 'hello',
    helper: null,
    availabilityNote: null,
    declinedReason: null,
    createdAt: { toMillis: () => 1 },
    ...overrides,
  };
}

function push(rows: Row[]) {
  act(() => h.next!({ docs: rows.map((r) => ({ id: r.offerId as string, data: () => r })) }));
}

beforeEach(() => {
  h.queries = [];
  h.collections = [];
  h.next = null;
  h.callables = [];
  h.auth = { firebaseUser: { uid: 'd1' } };
});

describe('MyOffersPage query shape (§7.3 pin)', () => {
  it('issues ONE query - doerUserId equality + createdAt desc, NO status filter', () => {
    renderWithProviders(<MyOffersPage />);
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0]).toEqual([
      { path: 'taskOffers' },
      { where: ['doerUserId', '==', 'd1'] },
      { orderBy: ['createdAt', 'desc'] },
    ]);
  });

  it('never reads doTasks - terminal cards render from the offer doc alone', () => {
    renderWithProviders(<MyOffersPage />);
    push([offer('o1', 'declined', { declinedReason: 'sibling_accepted' })]);
    fireEvent.click(screen.getByRole('tab', { name: 'Declined' }));
    expect(screen.getByText('Title o1')).toBeInTheDocument();
    expect(h.collections).not.toContain('doTasks');
  });
});

describe('MyOffersPage tabs (client-side narrowing)', () => {
  it('groups the five §9.2 tabs from the one list, expired sharing the declined tab', () => {
    renderWithProviders(<MyOffersPage />);
    push([
      offer('p1', 'pending'),
      offer('g1', 'pending_guardian'),
      offer('a1', 'accepted'),
      offer('d1', 'declined', { declinedReason: 'family_declined' }),
      offer('e1', 'expired'),
      offer('w1', 'withdrawn'),
    ]);

    expect(screen.getByText('Title p1')).toBeInTheDocument();
    expect(screen.queryByText('Title g1')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Awaiting parent' }));
    expect(screen.getByText('Title g1')).toBeInTheDocument();
    expect(screen.getByText('Your parent needs to approve this offer before the family sees it.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Accepted' }));
    expect(screen.getByText('Title a1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Declined' }));
    expect(screen.getByText('Title d1')).toBeInTheDocument();
    expect(screen.getByText('Title e1')).toBeInTheDocument();
    expect(screen.getByText('Task closed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Withdrawn' }));
    expect(screen.getByText('Title w1')).toBeInTheDocument();
  });
});

describe('MyOffersPage §4.2 terminal fallback (dead offer = summary line, never a broken link)', () => {
  it('terminal offers do NOT link; live and accepted offers do', () => {
    renderWithProviders(<MyOffersPage />);
    push([offer('p1', 'pending'), offer('d1', 'declined', { declinedReason: 'sibling_accepted' }), offer('w1', 'withdrawn')]);

    // Pending links to the (open, hence readable) task.
    expect(screen.getByText('Title p1').closest('a')).toHaveAttribute('href', '/tasks/task-p1');

    fireEvent.click(screen.getByRole('tab', { name: 'Declined' }));
    expect(screen.getByText('Title d1').closest('a')).toBeNull();
    expect(screen.getByText('The family chose another student.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Withdrawn' }));
    expect(screen.getByText('Title w1').closest('a')).toBeNull();
  });

  it('a family_declined offer states the family declined (decision 18: re-offering stays possible from the board)', () => {
    renderWithProviders(<MyOffersPage />);
    push([offer('d1', 'declined', { declinedReason: 'family_declined' })]);
    fireEvent.click(screen.getByRole('tab', { name: 'Declined' }));
    expect(screen.getByText(/The family declined this offer/)).toBeInTheDocument();
  });
});

describe('MyOffersPage actions', () => {
  it('pending offers carry update + withdraw; withdrawing calls doWithdrawOffer', async () => {
    renderWithProviders(<MyOffersPage />);
    push([offer('p1', 'pending')]);

    expect(screen.getByRole('link', { name: 'Update' })).toHaveAttribute('href', '/tasks/task-p1/offer');
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw offer' }));
    await waitFor(() => expect(h.callables).toHaveLength(1));
    expect(h.callables[0]).toEqual({ name: 'doWithdrawOffer', payload: { offerId: 'p1' } });
  });

  it('awaiting-parent offers can be withdrawn but NOT updated (§4.2: no edits under an approving parent)', () => {
    renderWithProviders(<MyOffersPage />);
    push([offer('g1', 'pending_guardian')]);
    fireEvent.click(screen.getByRole('tab', { name: 'Awaiting parent' }));
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Update' })).toBeNull();
  });
});
