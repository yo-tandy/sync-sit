import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import type { TaskDoc } from '@ejm/do-core';

/**
 * Assigned-task view pins (plan §9.1 last bullet, decision 16, §6.4):
 * - contact fetched LIVE via doGetAssignedContact with a loading state;
 * - error state with retry; grace_elapsed maps to its own copy (the §6.4
 *   post-cancel grace: the view still CALLS the callable for cancelled
 *   tasks — the server decides whether the 7 days ran out);
 * - the §5 considerations render as a checklist;
 * - mark-done / cancel wired for an assigned task, absent otherwise.
 */

const h = vi.hoisted(() => ({
  getAssignedContact: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    if (name !== 'doGetAssignedContact') throw new Error(`unexpected callable ${name}`);
    return h.getAssignedContact(payload);
  },
}));

import { AssignedTaskView } from '../AssignedTaskView';

function task(overrides: Partial<TaskDoc> = {}): TaskDoc {
  return {
    taskId: 'task1',
    familyId: 'fam1',
    createdByUserId: 'p1',
    familyName: 'Durand',
    areaLabel: '16e',
    category: 'ikea',
    subCategory: 'ikea_assembly',
    title: 'Assemble PAX',
    description: 'Two wardrobes',
    photos: [],
    timing: 'deadline',
    date: null,
    startTime: null,
    endTime: null,
    dueDate: '2026-09-15',
    startDate: null,
    endDate: null,
    cadence: null,
    estimatedHours: null,
    suggestedBudget: null,
    adultPresent: 'yes',
    toolsProvided: null,
    transportNeeded: false,
    status: 'assigned',
    offerCount: 0,
    assignedUserId: 'doer1',
    assignedOfferId: 'task1_doer1',
    assignedAt: null,
    agreedPrice: 45,
    doerMarkedDoneAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    createdAt: {} as TaskDoc['createdAt'],
    updatedAt: {} as TaskDoc['updatedAt'],
    expiresAt: {} as TaskDoc['expiresAt'],
    ...overrides,
  };
}

const CONTACT = {
  taskId: 'task1',
  family: { familyName: 'Durand', address: '1 rue de la Paix', parents: [] },
  doer: {
    firstName: 'Emma',
    lastName: 'Martin',
    contactEmail: 'emma@example.com',
    contactPhone: '+33612345678',
    whatsapp: null,
  },
};

function renderView(t = task(), props: Partial<Parameters<typeof AssignedTaskView>[0]> = {}) {
  return renderWithProviders(
    <AssignedTaskView
      task={t}
      doerFirstName="Emma"
      onMarkDone={props.onMarkDone ?? vi.fn()}
      onCancel={props.onCancel ?? vi.fn()}
      busy={false}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getAssignedContact.mockResolvedValue({ data: CONTACT });
});

describe('AssignedTaskView contact reveal (decision 16)', () => {
  it('shows the loading state, then the live contact details', async () => {
    let resolve!: (v: unknown) => void;
    h.getAssignedContact.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderView();

    expect(screen.getByText('Fetching contact details...')).toBeInTheDocument();
    resolve({ data: CONTACT });
    await waitFor(() => expect(screen.getByText('Emma Martin')).toBeInTheDocument());
    expect(h.getAssignedContact).toHaveBeenCalledWith({ taskId: 'task1' });
    expect(screen.getByText('+33612345678')).toBeInTheDocument();
    expect(screen.getByText('emma@example.com')).toBeInTheDocument();
  });

  it('shows the error state with a retry that refetches', async () => {
    h.getAssignedContact.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { code: 'functions/internal' }),
    );
    renderView();
    await waitFor(() =>
      expect(screen.getByText(/Could not load contact details/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('Emma Martin')).toBeInTheDocument());
    expect(h.getAssignedContact).toHaveBeenCalledTimes(2);
  });

  it('still calls the callable for a cancelled task (the §6.4 grace serves it) and shows the grace note', async () => {
    renderView(task({ status: 'cancelled', cancelledBy: 'family' }));
    await waitFor(() => expect(screen.getByText('Emma Martin')).toBeInTheDocument());
    expect(h.getAssignedContact).toHaveBeenCalledWith({ taskId: 'task1' });
    expect(screen.getByText(/Contact details stay available for a few days/)).toBeInTheDocument();
    expect(screen.getByText('This task was cancelled.')).toBeInTheDocument();
  });

  it('maps grace_elapsed to its own copy, not the generic error', async () => {
    h.getAssignedContact.mockRejectedValueOnce(
      Object.assign(new Error('gone'), {
        code: 'functions/failed-precondition',
        details: { reason: 'grace_elapsed' },
      }),
    );
    renderView(task({ status: 'cancelled' }));
    await waitFor(() =>
      expect(
        screen.getByText('Contact details are no longer available for this cancelled task.'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Could not load contact details/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('AssignedTaskView checklist and actions', () => {
  it('renders the §5 considerations as a checklist (surface 3 of 3)', async () => {
    renderView();
    expect(screen.getByText('Before you start')).toBeInTheDocument();
    // One ikea consideration from do-core's content module, as a checkbox.
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(3);
    expect(screen.getByText(/instructions and all the parts/i)).toBeInTheDocument();
    fireEvent.click(boxes[0]);
    expect(boxes[0]).toBeChecked();
  });

  it('wires mark-done and cancel for an assigned task', async () => {
    const onMarkDone = vi.fn();
    const onCancel = vi.fn();
    renderView(task(), { onMarkDone, onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as completed' }));
    expect(onMarkDone).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('hides the actions and shows the banner on a completed task, and flags a doer-marked-done one', async () => {
    const { unmount } = renderView(task({ status: 'completed' }));
    expect(screen.getByText('This task is completed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as completed' })).toBeNull();
    unmount();

    renderView(task({ doerMarkedDoneAt: {} as TaskDoc['doerMarkedDoneAt'] }));
    expect(screen.getByText(/The student marked this task done/)).toBeInTheDocument();
  });
});
