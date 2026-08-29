import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Recording httpsCallable mock, the FamiliesPage idiom: the REAL adminStore
// runs against it, so these tests pin the exact callable names and payloads
// the sync-do Tasks tab sends (plan §9.4).
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  // Responses for successive list calls; the last one repeats.
  pages: [] as { tasks: Record<string, unknown>[]; hasMore: boolean; truncated?: boolean }[],
  offers: [] as Record<string, unknown>[],
  failNext: false,
  failOffers: false,
  failDelete: false,
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));

// The ui barrel pulls the auth store (module-scope onAuthStateChanged) — stub it.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ userDoc: null, firebaseUser: null }),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    if (name === 'doAdminListTasks') {
      // Detail mode is the same callable with a taskId.
      if ((payload as { taskId?: string })?.taskId) {
        if (h.failOffers) {
          h.failOffers = false;
          return Promise.reject(new Error('internal'));
        }
        return Promise.resolve({ data: { tasks: [], offers: [...h.offers], hasMore: false } });
      }
      if (h.failNext) {
        h.failNext = false;
        return Promise.reject(new Error('internal'));
      }
      const page = h.pages.length > 1 ? h.pages.shift()! : h.pages[0];
      return Promise.resolve({
        data: { tasks: [...page.tasks], hasMore: page.hasMore, truncated: page.truncated },
      });
    }
    if (name === 'doAdminDeleteTask' && h.failDelete) {
      h.failDelete = false;
      return Promise.reject(new Error('internal'));
    }
    return Promise.resolve({ data: { success: true } });
  },
}));

import i18n from '@/i18n';
import { AdminDoTasksPage } from '../DoTasksPage';
import { useAdminStore } from '@/stores/adminStore';

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-pax',
    familyId: 'fam-dupont',
    familyName: 'Dupont',
    createdByUserId: 'p1',
    areaLabel: '16e',
    category: 'ikea',
    subCategory: 'ikea_assembly',
    title: 'Assemble a PAX',
    description: 'Two-door PAX with mirror.',
    status: 'open',
    timing: 'deadline',
    offerCount: 2,
    photoCount: 1,
    suggestedBudget: null,
    agreedPrice: null,
    assignedUserId: null,
    adultPresent: 'yes',
    createdAt: '2026-01-01T10:00:00.000Z',
    expiresAt: '2026-02-01T10:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    ...overrides,
  };
}

function offer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-pax_doer-1',
    taskId: 'task-pax',
    doerUserId: 'doer-1',
    doerFirstName: 'Dora',
    price: 40,
    priceBasis: 'flat',
    message: 'I have built three of these.',
    helper: null,
    status: 'pending',
    guardianRequired: false,
    declinedReason: null,
    createdAt: '2026-01-02T10:00:00.000Z',
    updatedAt: '2026-01-02T10:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminDoTasksPage />
    </MemoryRouter>,
  );
}

const listCalls = () => h.calls.filter((c) => c.name === 'doAdminListTasks' && !(c.payload as { taskId?: string })?.taskId);
const detailCalls = () => h.calls.filter((c) => c.name === 'doAdminListTasks' && (c.payload as { taskId?: string })?.taskId);
const deleteCalls = () => h.calls.filter((c) => c.name === 'doAdminDeleteTask');

describe('AdminDoTasksPage', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
    h.calls.length = 0;
    h.pages = [{ tasks: [task()], hasMore: false }];
    h.offers = [];
    h.failNext = false;
    h.failOffers = false;
    h.failDelete = false;
    // The zustand store is a module-level singleton — reset the slice.
    useAdminStore.setState({
      doTasks: [],
      doTasksLoading: false,
      doTasksLoadingMore: false,
      doTasksHasMore: false,
      doTasksError: false,
      doTasksTruncated: false,
    });
  });

  afterEach(() => cleanup());

  it('fetches on mount with an empty payload (undefined fields omitted)', async () => {
    renderPage();
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    expect(listCalls()[0].payload).toEqual({});
    expect(await screen.findByText('Assemble a PAX')).toBeInTheDocument();
    expect(screen.getByText('Dupont')).toBeInTheDocument();
  });

  it('sends each filter under the payload key the callable expects', async () => {
    renderPage();
    await waitFor(() => expect(listCalls()).toHaveLength(1));

    fireEvent.change(screen.getByPlaceholderText(/search by title/i), {
      target: { value: 'pax' },
    });
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    expect(listCalls()[1].payload).toEqual({ searchQuery: 'pax' });

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'green_thumb' } });
    await waitFor(() => expect(listCalls()).toHaveLength(3));
    expect(listCalls()[2].payload).toEqual({
      searchQuery: 'pax',
      categoryFilter: 'green_thumb',
    });

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'completed' } });
    await waitFor(() => expect(listCalls()).toHaveLength(4));
    expect(listCalls()[3].payload).toEqual({
      searchQuery: 'pax',
      categoryFilter: 'green_thumb',
      statusFilter: 'completed',
    });

    fireEvent.change(screen.getByPlaceholderText(/filter by family id/i), {
      target: { value: 'fam-dupont' },
    });
    await waitFor(() => expect(listCalls()).toHaveLength(5));
    expect(listCalls()[4].payload).toEqual({
      searchQuery: 'pax',
      categoryFilter: 'green_thumb',
      statusFilter: 'completed',
      familyIdFilter: 'fam-dupont',
    });
  });

  it('maps the "all" option back to no filter at all', async () => {
    renderPage();
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'ikea' } });
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'all' } });
    await waitFor(() => expect(listCalls()).toHaveLength(3));
    expect(listCalls()[2].payload).toEqual({});
  });

  it('loads a task\'s offers on demand, not with the list', async () => {
    h.offers = [
      offer(),
      offer({
        id: 'task-pax_doer-2',
        doerUserId: 'doer-2',
        doerFirstName: 'Gus',
        status: 'pending_guardian',
        message: 'Free on Sunday afternoon.',
        helper: { firstName: 'Leo', lastName: 'Martin', age: 14 },
      }),
    ];
    renderPage();
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    // Nothing offer-shaped has been requested yet.
    expect(detailCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /^details$/i }));
    await waitFor(() => expect(detailCalls()).toHaveLength(1));
    expect(detailCalls()[0].payload).toEqual({ taskId: 'task-pax' });

    expect(await screen.findByText(/I have built three of these/)).toBeInTheDocument();
    expect(screen.getByText('pending_guardian')).toBeInTheDocument();
    // The §11.3 +1 disclosure renders with name and age.
    expect(screen.getByText(/Leo Martin, age 14/)).toBeInTheDocument();
  });

  it('shows an offers-specific error without breaking the row', async () => {
    h.failOffers = true;
    renderPage();
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /^details$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load offers/i);
    expect(screen.getByText('Assemble a PAX')).toBeInTheDocument();
  });

  it('confirms before deleting, warns about the cascade, then refetches', async () => {
    renderPage();
    await waitFor(() => expect(listCalls()).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    // The copy has to say what a hard delete takes with it (§11.4).
    expect(
      screen.getByText(/also deletes every offer on it and its photo files/i),
    ).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(deleteCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0].payload).toEqual({ taskId: 'task-pax' });
    // A refetch follows so the row leaves the table.
    await waitFor(() => expect(listCalls().length).toBeGreaterThanOrEqual(2));
  });

  it('pages with the last row id as the cursor and appends', async () => {
    h.pages = [
      { tasks: [task()], hasMore: true },
      { tasks: [task({ id: 'task-boxes', title: 'Carry boxes' })], hasMore: false },
    ];
    renderPage();
    await waitFor(() => expect(listCalls()).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    expect(listCalls()[1].payload).toEqual({ startAfterId: 'task-pax' });
    expect(await screen.findByText('Carry boxes')).toBeInTheDocument();
    expect(screen.getByText('Assemble a PAX')).toBeInTheDocument();
  });

  it('renders the empty state when there are no tasks', async () => {
    h.pages = [{ tasks: [], hasMore: false }];
    renderPage();
    expect(await screen.findByText(/no tasks found/i)).toBeInTheDocument();
  });

  // Round-1 note: a failed delete used to close the dialog exactly as a
  // success does, leaving the row in place with no message — on the one
  // action in this panel that also deletes files.
  it('keeps the delete dialog open and explains a failure', async () => {
    h.failDelete = true;
    renderPage();
    await waitFor(() => expect(listCalls()).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not delete the task/i);
    // Still open, so the admin can retry or escalate rather than read the
    // closed dialog as success.
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    // And no refetch was issued — nothing changed.
    expect(listCalls()).toHaveLength(1);
  });

  // A search that filled its server-side window must not present "no match"
  // as a definitive answer.
  it('warns when the search window truncated the results', async () => {
    h.pages = [{ tasks: [], hasMore: false, truncated: true }];
    renderPage();
    expect(await screen.findByRole('status')).toHaveTextContent(
      /only the most recent tasks were searched/i,
    );
  });

  it('renders a load-error banner distinguishable from the empty state', async () => {
    h.pages = [{ tasks: [], hasMore: false }];
    h.failNext = true;
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load tasks/i);
    expect(screen.queryByText(/no tasks found/i)).not.toBeInTheDocument();
  });
});
