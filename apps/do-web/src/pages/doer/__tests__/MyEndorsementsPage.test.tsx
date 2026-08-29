import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * "My endorsements" (plan §9.2, decision 12). The load-bearing pins:
 * - ONE query: where(doerUserId == me) + orderBy(createdAt desc), and NO
 *   status filter. It is provable only through the §12/#300 recipient
 *   disjunct; a status filter here would silently drop the pending rows the
 *   page exists to show.
 * - accept/decline are NON-OPTIMISTIC — the row's status changes only after
 *   the callable resolves, because publishing family-authored text about
 *   yourself is a consent decision.
 * - a failed read is an ERROR with a retry, never the reassuring empty
 *   state.
 * - `removed` rows are hidden entirely.
 */

const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 'doer1' } as unknown },
  queries: [] as unknown[][],
  rows: [] as Record<string, unknown>[],
  fail: false,
  callables: [] as { name: string; payload: unknown }[],
  reject: false,
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => (payload: unknown) => {
    h.callables.push({ name, payload });
    return h.reject ? Promise.reject(new Error('nope')) : Promise.resolve({ data: { ok: true } });
  },
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  getDocs: (q: { query: unknown[] }) => {
    h.queries.push(q.query);
    if (h.fail) return Promise.reject(new Error('denied'));
    return Promise.resolve({ docs: h.rows.map((r) => ({ id: r.referenceId, data: () => r })) });
  },
}));

import { MyEndorsementsPage } from '../MyEndorsementsPage';

function endorsement(id: string, overrides: Record<string, unknown> = {}) {
  return {
    referenceId: id,
    doerUserId: 'doer1',
    appSource: 'do',
    type: 'family_submitted',
    status: 'private',
    submittedByUserId: 'p1',
    submittedByFamilyId: 'fam1',
    submittedByName: 'Marie Dupont',
    refName: 'Marie',
    referenceText: `Body of ${id}`,
    category: 'ikea',
    createdAt: new Date('2026-08-01T10:00:00Z'),
    updatedAt: new Date('2026-08-01T10:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  h.queries = [];
  h.rows = [];
  h.fail = false;
  h.reject = false;
  h.callables = [];
});

describe('MyEndorsementsPage query shape', () => {
  it('issues ONE query — doerUserId == me, createdAt desc, and NO status filter', async () => {
    h.rows = [endorsement('e1')];
    renderWithProviders(<MyEndorsementsPage />);
    await waitFor(() => expect(h.queries).toHaveLength(1));
    expect(h.queries[0]).toEqual([
      { path: 'references' },
      { where: ['doerUserId', '==', 'doer1'] },
      { orderBy: ['createdAt', 'desc'] },
    ]);
    // A status filter would drop the pending rows this page exists to show.
    expect(JSON.stringify(h.queries[0])).not.toContain('status');
  });
});

describe('MyEndorsementsPage rendering', () => {
  it('splits pending from the published set and hides removed rows', async () => {
    h.rows = [
      endorsement('e-pending'),
      endorsement('e-approved', { status: 'approved' }),
      endorsement('e-published', { status: 'published' }),
      endorsement('e-removed', { status: 'removed' }),
    ];
    renderWithProviders(<MyEndorsementsPage />);
    await waitFor(() => expect(screen.getByText('Body of e-pending')).toBeInTheDocument());

    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
    expect(screen.getByText('Shown with your offers')).toBeInTheDocument();
    expect(screen.getByText('Body of e-approved')).toBeInTheDocument();
    expect(screen.getByText('Body of e-published')).toBeInTheDocument();
    // A declined endorsement is gone, not archived.
    expect(screen.queryByText('Body of e-removed')).toBeNull();

    // Actions belong to the pending section only.
    expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(1);
  });

  it('shows the category and date meta line', async () => {
    h.rows = [endorsement('e1')];
    renderWithProviders(<MyEndorsementsPage />);
    await waitFor(() => expect(screen.getByText(/Ikea assembly/)).toBeInTheDocument());
    expect(screen.getByText(/Ikea assembly · Aug 1, 2026/)).toBeInTheDocument();
  });

  // Defence in depth (PR #352 round-1 review). Before the create rule was
  // tightened, any authenticated user could mint a manual reference about
  // themselves carrying a foreign `doerUserId` plus arbitrary text — and this
  // page's deliberately status-unfiltered query would return it. Such a doc
  // is UNACTIONABLE: doRespondToEndorsement refuses it at
  // `type !== 'family_submitted'` / `appSource !== 'do'`, so rendering it
  // would give the doer a permanent row whose buttons the server rejects.
  it('hides rows this surface cannot act on — a smuggled doerUserId never renders', async () => {
    h.rows = [
      endorsement('e-real'),
      // The forged shape: a sit MANUAL reference about the attacker that
      // merely names this doer.
      endorsement('e-forged', {
        appSource: undefined,
        type: 'manual',
        babysitterUserId: 'attacker',
        submittedByName: 'Sync Support',
        referenceText: 'Call 0800-SCAM to claim your payment.',
      }),
      // ...and the same trick relabelled, in case only `type` were checked.
      endorsement('e-forged-2', { appSource: 'study', type: 'manual' }),
    ];
    renderWithProviders(<MyEndorsementsPage />);
    await waitFor(() => expect(screen.getByText('Body of e-real')).toBeInTheDocument());
    expect(screen.queryByText(/0800-SCAM/)).toBeNull();
    expect(screen.queryByText('Body of e-forged-2')).toBeNull();
    // Exactly one actionable row, so exactly one pair of buttons.
    expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(1);
  });

  // `category` is server-copied from a real §4.3 key, but an unknown value
  // must not print raw as "categories.foo" in the meta line.
  it('drops an unknown category rather than rendering its raw i18n key', async () => {
    h.rows = [endorsement('e1', { category: 'not_a_category' })];
    renderWithProviders(<MyEndorsementsPage />);
    await waitFor(() => expect(screen.getByText('Body of e1')).toBeInTheDocument());
    expect(screen.queryByText(/categories\./)).toBeNull();
    // The date half of the meta line survives.
    expect(screen.getByText('Aug 1, 2026')).toBeInTheDocument();
  });

  it('renders the empty state when there is nothing at all', async () => {
    renderWithProviders(<MyEndorsementsPage />);
    await waitFor(() => expect(screen.getByText(/No endorsements yet/)).toBeInTheDocument());
  });

  // A failed read must not read as "you have none" — that is an affirmative
  // false statement about the doer's own reputation.
  it('shows an error with a retry, never the empty state, when the read fails', async () => {
    h.fail = true;
    renderWithProviders(<MyEndorsementsPage />);
    await waitFor(() =>
      expect(screen.getByText(/Could not load your endorsements/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/No endorsements yet/)).toBeNull();

    h.fail = false;
    h.rows = [endorsement('e-after-retry')];
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('Body of e-after-retry')).toBeInTheDocument());
  });
});

describe('MyEndorsementsPage responses', () => {
  it('accept calls doRespondToEndorsement and moves the row only after it resolves', async () => {
    h.rows = [endorsement('e1')];
    renderWithProviders(<MyEndorsementsPage />);
    await waitFor(() => expect(screen.getByText('Body of e1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(screen.queryByText('Waiting for you')).toBeNull());
    expect(h.callables).toEqual([
      { name: 'doRespondToEndorsement', payload: { referenceId: 'e1', action: 'accept' } },
    ]);
    expect(screen.getByText('Shown with your offers')).toBeInTheDocument();
  });

  it('a failed response leaves the row PENDING and surfaces the error', async () => {
    h.rows = [endorsement('e1')];
    h.reject = true;
    renderWithProviders(<MyEndorsementsPage />);
    await waitFor(() => expect(screen.getByText('Body of e1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(screen.getByText(/Could not save your response/)).toBeInTheDocument(),
    );
    // Non-optimistic: the row did NOT move to the published section.
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
    expect(screen.queryByText('Shown with your offers')).toBeNull();
  });

  // Declining is permanent, so it goes through a confirm — and the confirm
  // closes BEFORE dispatching, so a refusal renders on the page rather than
  // behind an aria-modal scrim.
  it('decline confirms first, then sends action: decline', async () => {
    h.rows = [endorsement('e1')];
    renderWithProviders(<MyEndorsementsPage />);
    await waitFor(() => expect(screen.getByText('Body of e1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(h.callables).toHaveLength(0);
    expect(screen.getByText('Decline this endorsement?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, decline it' }));
    await waitFor(() => expect(h.callables).toHaveLength(1));
    expect(h.callables[0]).toEqual({
      name: 'doRespondToEndorsement',
      payload: { referenceId: 'e1', action: 'decline' },
    });
    // Removed rows are hidden, so the body disappears entirely.
    await waitFor(() => expect(screen.queryByText('Body of e1')).toBeNull());
  });

  // sync-do says `decline`, not study's `dismiss` — the callable's validator
  // rejects `dismiss`, so a payload drift here would fail in production.
  it("never sends study's 'dismiss' vocabulary", async () => {
    h.rows = [endorsement('e1')];
    renderWithProviders(<MyEndorsementsPage />);
    await waitFor(() => expect(screen.getByText('Body of e1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, decline it' }));
    await waitFor(() => expect(h.callables).toHaveLength(1));
    expect(JSON.stringify(h.callables)).not.toContain('dismiss');
  });
});
