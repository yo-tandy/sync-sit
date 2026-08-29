import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * Doer task detail (plan §9.2). Pins:
 * - everything the family published renders, the §5 considerations as
 *   "what to ask before you offer", the adultPresent badge, the §5.6
 *   money line on handlesFamilyMoney sub-categories;
 * - §11.2 negative pin: a poisoned address/latLng never renders;
 * - own-offer states drive the CTA (make / update / offer-again /
 *   awaiting-parent), and the own-offer read is the equality query, never
 *   a doc get (a missing doc's get errors §7.2's rule);
 * - a permission-denied task read renders the not-available state
 *   (§7.2's open-or-own-assignment scope), and an assigned-to-me task
 *   renders the AssignedWorkView instead of the published view.
 */

const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 'd1' } as unknown, userDoc: null as unknown },
  taskNext: null as null | ((snap: unknown) => void),
  taskError: null as null | ((err: unknown) => void),
  offerNext: null as null | ((snap: unknown) => void),
  offerQueries: [] as unknown[][],
  getDocCalls: 0,
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => () => {
    if (name === 'doGetAssignedContact') {
      return Promise.resolve({
        data: {
          taskId: 't1',
          family: { familyName: 'Durand', address: '8 rue du Théâtre', parents: [] },
          doer: { firstName: 'Léo', lastName: 'M' },
        },
      });
    }
    return new Promise(() => {}); // photo URLs: irrelevant here
  },
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  getDoc: () => {
    h.getDocCalls += 1;
    return Promise.reject(new Error('detail page must not getDoc'));
  },
  onSnapshot: (target: unknown, next: (snap: unknown) => void, error: (err: unknown) => void) => {
    if ((target as { query?: unknown[] }).query) {
      h.offerQueries.push((target as { query: unknown[] }).query);
      h.offerNext = next;
    } else {
      h.taskNext = next;
      h.taskError = error;
    }
    return vi.fn();
  },
}));

import { DoerTaskDetailPage } from '../DoerTaskDetailPage';

type Row = Record<string, unknown>;
function task(overrides: Row = {}): Row {
  return {
    taskId: 't1',
    familyId: 'fam1',
    familyName: 'Durand',
    areaLabel: '16e',
    title: 'Pharmacy run',
    description: 'Pick up a prescription at the pharmacy on the corner.',
    photos: [],
    category: 'errands',
    subCategory: 'errands_pharmacy', // §5.6: handlesFamilyMoney + guardianConsent
    timing: 'deadline',
    dueDate: '2026-09-15',
    startDate: null,
    endDate: null,
    date: null,
    startTime: null,
    endTime: null,
    cadence: null,
    estimatedHours: 1,
    suggestedBudget: 10,
    adultPresent: 'no',
    toolsProvided: null,
    transportNeeded: false,
    status: 'open',
    assignedUserId: null,
    agreedPrice: null,
    doerMarkedDoneAt: null,
    // POISON (§11.2): must never render.
    address: '12 rue des Peupliers',
    latLng: { lat: 48.85, lng: 2.29 },
    expiresAt: { toMillis: () => Date.now() + 86400000 },
    ...overrides,
  };
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/tasks/:taskId" element={<DoerTaskDetailPage />} />
    </Routes>,
    '/tasks/t1',
  );
}

function pushTask(row: Row | null) {
  act(() => h.taskNext!({ exists: () => row !== null, id: 't1', data: () => row }));
}
function pushOffers(rows: Row[]) {
  act(() => h.offerNext!({ docs: rows.map((r) => ({ id: (r.offerId as string) ?? 'o1', data: () => r })) }));
}

beforeEach(() => {
  h.auth = { firebaseUser: { uid: 'd1' }, userDoc: { uid: 'd1', profiles: { doer: {} } } };
  h.taskNext = null;
  h.taskError = null;
  h.offerNext = null;
  h.offerQueries = [];
  h.getDocCalls = 0;
});

describe('DoerTaskDetailPage published content (§9.2)', () => {
  it('renders what the family published + considerations as what-to-ask + the money line', () => {
    renderDetail();
    pushTask(task());
    pushOffers([]);

    expect(screen.getByText('Pharmacy run')).toBeInTheDocument();
    expect(screen.getByText(/Pick up a prescription/)).toBeInTheDocument();
    expect(screen.getByText(/16e/)).toBeInTheDocument();
    expect(screen.getByText('Durand')).toBeInTheDocument();
    // The §5 list, in its offer-side framing (surface 2 of 3).
    expect(screen.getByText('What to ask before you offer')).toBeInTheDocument();
    // errands_pharmacy carries §5.6's receipt line.
    expect(screen.getByText(/always keep the receipt/i)).toBeInTheDocument();
    // adultPresent badge, 'no' variant.
    expect(screen.getByText(/Adult present.*No/)).toBeInTheDocument();
    // §5.6 handlesFamilyMoney -> the standing platform money line.
    expect(screen.getByText(/Sync\/Do handles no money/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Make an offer' })).toHaveAttribute('href', '/tasks/t1/offer');
  });

  it('NEVER renders the poisoned address or latLng (§11.2)', () => {
    const { container } = renderDetail();
    pushTask(task());
    pushOffers([]);
    expect(container.innerHTML).not.toContain('12 rue des Peupliers');
    expect(container.innerHTML).not.toContain('48.85');
  });

  it('reads the own offer via the equality query, never getDoc', () => {
    renderDetail();
    pushTask(task());
    pushOffers([]);
    expect(h.getDocCalls).toBe(0);
    expect(h.offerQueries[0]).toEqual([
      { path: 'taskOffers' },
      { where: ['doerUserId', '==', 'd1'] },
      { where: ['taskId', '==', 't1'] },
    ]);
  });
});

describe('DoerTaskDetailPage own-offer CTA states', () => {
  it('a pending offer swaps the CTA for the your-offer card with update', () => {
    renderDetail();
    pushTask(task());
    pushOffers([{ offerId: 't1_d1', status: 'pending', price: 12, taskId: 't1' }]);
    expect(screen.queryByRole('link', { name: 'Make an offer' })).toBeNull();
    expect(screen.getByText(/Your offer/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Update your offer' })).toHaveAttribute('href', '/tasks/t1/offer');
  });

  it('a pending_guardian offer shows the awaiting-parent hint, no update link (§6.2 badge)', () => {
    renderDetail();
    pushTask(task());
    pushOffers([{ offerId: 't1_d1', status: 'pending_guardian', price: 12, taskId: 't1' }]);
    expect(screen.getByText(/with your parent for approval/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Update your offer' })).toBeNull();
  });

  it('a withdrawn offer surfaces offer-again (decision 18 applies the same to family_declined)', () => {
    renderDetail();
    pushTask(task());
    pushOffers([{ offerId: 't1_d1', status: 'withdrawn', price: 12, taskId: 't1' }]);
    expect(screen.getByRole('link', { name: 'Offer again' })).toHaveAttribute('href', '/tasks/t1/offer');
  });

  it('an expired open task hides the offer CTA (§6.1: filtered, not a status)', () => {
    renderDetail();
    pushTask(task({ expiresAt: { toMillis: () => Date.now() - 1000 } }));
    pushOffers([]);
    expect(screen.getByText(/expired and no longer accepts offers/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Make an offer' })).toBeNull();
  });
});

describe('DoerTaskDetailPage assigned + unavailable states', () => {
  it('renders the AssignedWorkView for the caller-s own assignment', async () => {
    renderDetail();
    pushTask(task({ status: 'assigned', assignedUserId: 'd1', assignedOfferId: 't1_d1', agreedPrice: 15 }));
    pushOffers([{ offerId: 't1_d1', status: 'accepted', price: 15, taskId: 't1' }]);
    await waitFor(() => expect(screen.getByText('Family contact details')).toBeInTheDocument());
    // The published-view CTA is gone; the money line is not repeated here.
    expect(screen.queryByRole('link', { name: 'Make an offer' })).toBeNull();
    // Description stays reachable past acceptance (PR #331 round 2's
    // details slot, mirrored on the doer side).
    expect(screen.getByText(/Pick up a prescription/)).toBeInTheDocument();
  });

  it('maps a permission-denied read to the not-available state (§7.2 scope, not an error page)', () => {
    renderDetail();
    act(() => h.taskError!(new Error('permission-denied')));
    expect(screen.getByText(/no longer available/)).toBeInTheDocument();
  });

  it('maps a vanished (swept) task to the same not-available state', () => {
    renderDetail();
    pushTask(null);
    expect(screen.getByText(/no longer available/)).toBeInTheDocument();
  });
});
