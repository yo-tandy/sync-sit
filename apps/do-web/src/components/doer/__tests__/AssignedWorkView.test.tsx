import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import type { TaskDoc } from '@ejm/do-core';

/**
 * The doer's assigned view (plan §9.2 "My tasks", same treatment as
 * PR7's family side — the shared useAssignedContact hook IS the reuse):
 * - the FAMILY half of doGetAssignedContact renders (name, address, each
 *   parent's channels) with loading / error+retry / grace_elapsed states;
 * - the cancelled state still CALLS the callable (§6.4's aftermath grace
 *   — the server decides whether the 7 days ran out) and shows the grace
 *   note next to whatever comes back;
 * - considerations checklist; mark-done hidden once doerMarkedDoneAt is
 *   set (awaiting-family banner instead); cancel stays available while
 *   assigned.
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

import { AssignedWorkView } from '../AssignedWorkView';

const CONTACT = {
  taskId: 'task1',
  family: {
    familyName: 'Durand',
    address: '8 rue du Théâtre, 75015 Paris',
    parents: [
      { firstName: 'Claire', lastName: 'Durand', email: 'claire@example.com', phone: '+33600000001' },
    ],
  },
  doer: { firstName: 'Léo', lastName: 'Martin', contactEmail: 'leo@example.com' },
};

function task(overrides: Partial<TaskDoc> = {}): TaskDoc {
  return {
    taskId: 'task1',
    familyId: 'fam1',
    createdByUserId: 'p1',
    familyName: 'Durand',
    areaLabel: '15e',
    category: 'pet_house',
    subCategory: 'pet_house_dog_walking',
    title: 'Walk Idéfix',
    description: 'Daily walk',
    photos: [],
    timing: 'ongoing',
    date: null,
    startTime: null,
    endTime: null,
    dueDate: null,
    startDate: '2026-09-01',
    endDate: null,
    cadence: { kind: 'daily' },
    estimatedHours: null,
    suggestedBudget: null,
    adultPresent: 'no',
    toolsProvided: null,
    transportNeeded: false,
    status: 'assigned',
    offerCount: 0,
    assignedUserId: 'd1',
    assignedOfferId: 'task1_d1',
    assignedAt: null,
    agreedPrice: 12,
    doerMarkedDoneAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    createdAt: null as unknown as TaskDoc['createdAt'],
    updatedAt: null as unknown as TaskDoc['updatedAt'],
    expiresAt: null as unknown as TaskDoc['expiresAt'],
    ...overrides,
  };
}

const noop = () => {};
function renderView(t: TaskDoc, props: Partial<{ onMarkDone: () => void; onCancel: () => void; busy: boolean }> = {}) {
  return renderWithProviders(
    <AssignedWorkView task={t} onMarkDone={props.onMarkDone ?? noop} onCancel={props.onCancel ?? noop} busy={props.busy ?? false} />,
  );
}

beforeEach(() => {
  h.getAssignedContact.mockReset();
});

describe('AssignedWorkView contact states (decision 16 / §6.4)', () => {
  it('shows loading, then the FAMILY half - name, address, each parent with channels', async () => {
    let resolve!: (v: unknown) => void;
    h.getAssignedContact.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderView(task());
    expect(screen.getByText('Fetching contact details...')).toBeInTheDocument();

    resolve({ data: CONTACT });
    await waitFor(() => expect(screen.getByText('8 rue du Théâtre, 75015 Paris')).toBeInTheDocument());
    expect(screen.getByText('Claire Durand')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+33600000001' })).toHaveAttribute('href', 'tel:+33600000001');
    expect(h.getAssignedContact).toHaveBeenCalledWith({ taskId: 'task1' });
  });

  it('maps a failure to the error state with a working retry', async () => {
    h.getAssignedContact.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ data: CONTACT });
    renderView(task());
    await waitFor(() => expect(screen.getByText('Could not load contact details. Please try again.')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('Claire Durand')).toBeInTheDocument());
    expect(h.getAssignedContact).toHaveBeenCalledTimes(2);
  });

  it('cancelled task: STILL calls the callable, shows the grace note while it serves (§6.4 aftermath grace)', async () => {
    h.getAssignedContact.mockResolvedValue({ data: CONTACT });
    renderView(task({ status: 'cancelled', cancelledBy: 'doer' }));
    await waitFor(() => expect(screen.getByText('Claire Durand')).toBeInTheDocument());
    expect(screen.getByText(/Contact details stay available for a few days/)).toBeInTheDocument();
    expect(h.getAssignedContact).toHaveBeenCalledTimes(1);
  });

  it('NEVER-ASSIGNED cancelled task: no callable call, no contact card, no grace note (PR #331 round 1 gate, owned by the shared hook)', () => {
    renderView(task({ status: 'cancelled', cancelledBy: 'family', assignedUserId: null, assignedOfferId: null, agreedPrice: null }));
    // The plain cancelled summary: banner only.
    expect(screen.getByText('This task was cancelled.')).toBeInTheDocument();
    expect(screen.queryByText('Family contact details')).toBeNull();
    expect(screen.queryByText(/Contact details stay available/)).toBeNull();
    expect(h.getAssignedContact).not.toHaveBeenCalled();
  });

  it('maps grace_elapsed to its own copy, not the error state', async () => {
    h.getAssignedContact.mockRejectedValue({ details: { reason: 'grace_elapsed' } });
    renderView(task({ status: 'cancelled', cancelledBy: 'family' }));
    await waitFor(() =>
      expect(screen.getByText('Contact details are no longer available for this cancelled task.')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('AssignedWorkView checklist and actions', () => {
  it('renders the §5 considerations as the pre-start checklist', async () => {
    h.getAssignedContact.mockResolvedValue({ data: CONTACT });
    renderView(task());
    expect(screen.getByText('Before you start')).toBeInTheDocument();
    // Dog-walking's considerations include the vet line (§5.7).
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(3);
  });

  it('offers mark-done + cancel while assigned and unmarked', async () => {
    h.getAssignedContact.mockResolvedValue({ data: CONTACT });
    const onMarkDone = vi.fn();
    const onCancel = vi.fn();
    renderView(task(), { onMarkDone, onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }));
    expect(onMarkDone).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this task' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('once doerMarkedDoneAt is set: awaiting-family banner, no second mark-done, cancel still available (§6.5)', async () => {
    h.getAssignedContact.mockResolvedValue({ data: CONTACT });
    renderView(task({ doerMarkedDoneAt: { toMillis: () => 5 } as unknown as TaskDoc['doerMarkedDoneAt'] }));
    expect(screen.getByText(/You marked this done/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as done' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel this task' })).toBeInTheDocument();
  });

  it('completed task: banner only, no actions, no checklist', async () => {
    h.getAssignedContact.mockResolvedValue({ data: CONTACT });
    renderView(task({ status: 'completed' }));
    expect(screen.getByText('This task is completed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as done' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel this task' })).toBeNull();
    expect(screen.queryByText('Before you start')).toBeNull();
  });
});
