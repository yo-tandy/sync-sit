import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * Task-detail pins (plan §9.1):
 * - the offer-list query shape: familyId + taskId + status-in the family's
 *   §7.2 ALLOW-LIST (pending/accepted/declined) + createdAt order — the
 *   four-field composite's exact shape;
 * - accept dialog content: the §11.3 helper disclosure and the decision-15
 *   liability line (§11.5's acceptance-dialog requirement), and the
 *   doAcceptOffer call;
 * - decline per offer via doDeclineOffer;
 * - the assigned branch renders the AssignedTaskView (contact + checklist)
 *   and doMarkTaskDone completes from its dialog.
 */

const h = vi.hoisted(() => ({
  auth: { userDoc: { uid: 'p1', profiles: { parent: { familyId: 'fam1' } } } as unknown },
  offerQueries: [] as unknown[][],
  taskNext: null as null | ((snap: unknown) => void),
  offersNext: null as null | ((snap: unknown) => void),
  callable: vi.fn(),
  unsub: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ docPath: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  limit: (n: number) => ({ limit: n }),
  getDocs: () => Promise.resolve({ docs: [] }),
  onSnapshot: (q: unknown, next: (snap: unknown) => void) => {
    if ((q as { docPath?: string }).docPath) {
      h.taskNext = next;
    } else {
      h.offerQueries.push((q as { query: unknown[] }).query);
      h.offersNext = next;
    }
    return h.unsub;
  },
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useParams: () => ({ taskId: 'task1' }) };
});

import { TaskDetailPage } from '../TaskDetailPage';

type Row = Record<string, unknown>;
function taskRow(overrides: Row = {}): Row {
  return {
    taskId: 'task1',
    familyId: 'fam1',
    title: 'Assemble PAX',
    description: 'Two wardrobes',
    category: 'ikea',
    subCategory: 'ikea_assembly',
    timing: 'deadline',
    dueDate: '2026-09-15',
    photos: [],
    status: 'open',
    assignedUserId: null,
    assignedOfferId: null,
    agreedPrice: null,
    doerMarkedDoneAt: null,
    ...overrides,
  };
}

function offerRow(id: string, overrides: Row = {}): Row {
  return {
    offerId: id,
    taskId: 'task1',
    doerUserId: 'doer1',
    familyId: 'fam1',
    doerFirstName: 'Emma',
    doerPhotoUrl: null,
    doerBio: null,
    price: 45,
    priceBasis: 'flat',
    message: 'Saturday works.',
    helper: null,
    availabilityNote: null,
    status: 'pending',
    ...overrides,
  };
}

function pushTask(row: Row | null) {
  act(() =>
    h.taskNext!({ exists: () => row !== null, id: 'task1', data: () => row }),
  );
}
function pushOffers(rows: Row[]) {
  act(() => h.offersNext!({ docs: rows.map((r) => ({ id: r.offerId as string, data: () => r })) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.offerQueries = [];
  h.taskNext = null;
  h.offersNext = null;
  h.callable.mockImplementation((name: string) => {
    if (name === 'doGetAssignedContact') {
      return Promise.resolve({
        data: {
          taskId: 'task1',
          family: { familyName: 'Durand', address: '', parents: [] },
          doer: { firstName: 'Emma', lastName: 'Martin', contactEmail: 'e@x.com', contactPhone: null, whatsapp: null },
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
});

describe('TaskDetailPage (open task)', () => {
  it('queries offers with the four-field composite shape — the §7.2 family allow-list statuses', () => {
    renderWithProviders(<TaskDetailPage />);
    pushTask(taskRow());
    expect(h.offerQueries).toHaveLength(1);
    expect(h.offerQueries[0]).toEqual([
      { path: 'taskOffers' },
      { where: ['familyId', '==', 'fam1'] },
      { where: ['taskId', '==', 'task1'] },
      { where: ['status', 'in', ['pending', 'accepted', 'declined']] },
      { orderBy: ['createdAt'] },
    ]);
  });

  it('renders pending offers, declined ones under their own heading, and the empty state', () => {
    renderWithProviders(<TaskDetailPage />);
    pushTask(taskRow());
    pushOffers([]);
    expect(screen.getByText(/No offers yet/)).toBeInTheDocument();

    pushOffers([
      offerRow('o1'),
      offerRow('o2', { doerFirstName: 'Hugo', status: 'declined' }),
    ]);
    expect(screen.getByText('Emma')).toBeInTheDocument();
    expect(screen.getByText('Declined offers')).toBeInTheDocument();
    expect(screen.getByText('Hugo')).toBeInTheDocument();
  });

  it('accept dialog pins the §11.3 helper disclosure + decision-15 liability line, then calls doAcceptOffer', async () => {
    renderWithProviders(<TaskDetailPage />);
    pushTask(taskRow());
    pushOffers([offerRow('o1', { helper: { firstName: 'Léo', lastName: 'Petit', age: 16 } })]);

    fireEvent.click(screen.getByRole('button', { name: 'Accept offer' }));
    expect(screen.getByText('Accept this offer?')).toBeInTheDocument();
    // §11.3 helper disclosure IN the dialog (both card and dialog carry it).
    expect(screen.getAllByText(/not a verified Sync member/).length).toBeGreaterThanOrEqual(2);
    // Decision-15 liability line at the moment of commitment (§11.5).
    expect(
      screen.getByText(/Insurance, accidents and any damage are your family's responsibility/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Accept & share contact details' }));
    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('doAcceptOffer', { offerId: 'o1' }));
  });

  it('maps a task_not_open acceptance race to its own copy', async () => {
    renderWithProviders(<TaskDetailPage />);
    pushTask(taskRow());
    pushOffers([offerRow('o1')]);
    h.callable.mockRejectedValueOnce(
      Object.assign(new Error('race'), {
        code: 'functions/failed-precondition',
        details: { reason: 'task_not_open' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept offer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept & share contact details' }));
    await waitFor(() =>
      expect(screen.getByText(/no longer open/)).toBeInTheDocument(),
    );
  });

  it('declines a single offer through its dialog', async () => {
    renderWithProviders(<TaskDetailPage />);
    pushTask(taskRow());
    pushOffers([offerRow('o1')]);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(screen.getByText('Decline this offer?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Decline offer' }));
    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('doDeclineOffer', { offerId: 'o1' }));
  });
});

describe('TaskDetailPage (assigned task)', () => {
  it('renders the assigned view — live contact, checklist — and completes via doMarkTaskDone', async () => {
    renderWithProviders(<TaskDetailPage />);
    pushTask(taskRow({ status: 'assigned', assignedUserId: 'doer1', assignedOfferId: 'o1', agreedPrice: 45 }));
    pushOffers([offerRow('o1', { status: 'accepted' })]);

    expect(screen.getByText('Assigned to Emma')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Emma Martin')).toBeInTheDocument());
    expect(h.callable).toHaveBeenCalledWith('doGetAssignedContact', { taskId: 'task1' });
    expect(screen.getByText('Before you start')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark as completed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, it is done' }));
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('doMarkTaskDone', { taskId: 'task1' }),
    );
  });

  it('cancels an assigned task through the confirm dialog', async () => {
    renderWithProviders(<TaskDetailPage />);
    pushTask(taskRow({ status: 'assigned', assignedOfferId: 'o1' }));
    pushOffers([offerRow('o1', { status: 'accepted' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }));
    expect(screen.getByText(/Emma will be notified/)).toBeInTheDocument();
    // The dialog's confirm CTA shares its label with the trigger; the last
    // rendered one is the dialog's.
    const buttons = screen.getAllByRole('button', { name: 'Cancel task' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('doCancelTask', { taskId: 'task1' }),
    );
  });

  it('shows not-found for a vanished task', () => {
    renderWithProviders(<TaskDetailPage />);
    pushTask(null);
    expect(screen.getByText('This task no longer exists.')).toBeInTheDocument();
  });
});
