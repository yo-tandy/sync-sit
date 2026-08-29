import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router';
import { renderWithProviders } from '@/__tests__/test-utils';
import { DO_OFFER_MESSAGE_MAX, DO_AVAILABILITY_NOTE_MAX } from '@ejm/do-core';

/**
 * The offer form (plan §9.2). The load-bearing pins:
 * - §6.2 UP FRONT: flagged sub-category + supervised caller (governedBy,
 *   the enrollment wizard's check) renders the approval-first banner
 *   before anything is typed; either condition absent -> no banner.
 * - Client validation runs against do-core's exported bounds (§6.3's "the
 *   two sides must share the same numbers") and blocks the round trip.
 * - Refusal mapping: each doSubmitOffer reason gets its own copy —
 *   task_offer_cap is the OVERSUBSCRIBED message, not a generic failure.
 */

const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 'd1' } as unknown, userDoc: null as unknown },
  task: null as Record<string, unknown> | null,
  existingOffers: [] as Record<string, unknown>[],
  callables: [] as { name: string; payload: unknown }[],
  reject: null as null | { details?: { reason?: string } },
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => (payload: unknown) => {
    h.callables.push({ name, payload });
    if (h.reject) return Promise.reject(h.reject);
    return Promise.resolve({ data: { offerId: 'o1', status: 'pending' } });
  },
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  getDoc: () =>
    Promise.resolve({
      exists: () => h.task !== null,
      id: 't1',
      data: () => h.task,
    }),
  getDocs: () =>
    Promise.resolve({ docs: h.existingOffers.map((o) => ({ id: 'o1', data: () => o })) }),
}));

import { OfferPage } from '../OfferPage';

function openTask(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 't1',
    status: 'open',
    title: 'Mount shelves',
    category: 'ikea',
    subCategory: 'ikea_wall_mounting', // §5.3: flagged guardianConsent
    timing: 'deadline',
    dueDate: '2026-09-15',
    suggestedBudget: null,
    ...overrides,
  };
}

function renderOffer() {
  return renderWithProviders(
    <Routes>
      <Route path="/doer/tasks/:taskId/offer" element={<OfferPage />} />
    </Routes>,
    '/doer/tasks/t1/offer',
  );
}

beforeEach(() => {
  h.auth = {
    firebaseUser: { uid: 'd1' },
    userDoc: { uid: 'd1', profiles: { doer: { enrollmentComplete: true } } },
  };
  h.task = openTask();
  h.existingOffers = [];
  h.callables = [];
  h.reject = null;
});

async function fillValid() {
  fireEvent.change(await screen.findByLabelText('Your price (EUR) *'), { target: { value: '40' } });
  fireEvent.change(screen.getByLabelText('Message to the family *'), {
    target: { value: 'I can do this on Wednesday.' },
  });
}

describe('OfferPage guardian gate up front (§6.2)', () => {
  it('shows the approval-first banner for a flagged sub-category and a SUPERVISED caller', async () => {
    h.auth.userDoc = { uid: 'd1', governedBy: 'parent1', profiles: { doer: {} } };
    renderOffer();
    expect(await screen.findByText(/Your parent approves first/)).toBeInTheDocument();
    expect(screen.getByText(/Your offer will go to them first/)).toBeInTheDocument();
  });

  it('no banner for the same flagged sub-category when the caller is NOT supervised', async () => {
    renderOffer();
    await screen.findByText('Mount shelves');
    expect(screen.queryByText(/Your parent approves first/)).toBeNull();
  });

  it('no banner for an unflagged sub-category even when supervised', async () => {
    h.auth.userDoc = { uid: 'd1', governedBy: 'parent1', profiles: { doer: {} } };
    h.task = openTask({ subCategory: 'ikea_assembly' });
    renderOffer();
    await screen.findByText('Mount shelves');
    expect(screen.queryByText(/Your parent approves first/)).toBeNull();
  });
});

describe('OfferPage validation vs do-core bounds', () => {
  it('blocks an empty form with price and message errors, no round trip', async () => {
    renderOffer();
    fireEvent.click(await screen.findByRole('button', { name: 'Send offer' }));
    expect(await screen.findByText('Must be a number between 0 and 1000')).toBeInTheDocument();
    expect(screen.getByText('A message is required')).toBeInTheDocument();
    expect(h.callables).toHaveLength(0);
  });

  it('rejects an out-of-bounds price', async () => {
    renderOffer();
    await fillValid();
    fireEvent.change(screen.getByLabelText('Your price (EUR) *'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(await screen.findByText('Must be a number between 0 and 1000')).toBeInTheDocument();
    expect(h.callables).toHaveLength(0);
  });

  it('rejects an over-length message against DO_OFFER_MESSAGE_MAX', async () => {
    renderOffer();
    await fillValid();
    fireEvent.change(screen.getByLabelText('Message to the family *'), {
      target: { value: 'x'.repeat(DO_OFFER_MESSAGE_MAX + 1) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(
      await screen.findByText(`At most ${DO_OFFER_MESSAGE_MAX} characters`),
    ).toBeInTheDocument();
    expect(h.callables).toHaveLength(0);
  });

  it('requires the full helper triple once the +1 toggle is on (§11.3)', async () => {
    renderOffer();
    await fillValid();
    fireEvent.click(screen.getByLabelText('I will bring a +1 helper'));
    // The §11.3 disclosure shows with the fields.
    expect(screen.getByText(/not a verified Sync member/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Helper first name *'), { target: { value: 'Max' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(
      await screen.findByText('A helper needs a first name, last name and age'),
    ).toBeInTheDocument();
    expect(h.callables).toHaveLength(0);
  });

  it('rejects an over-length availability note against DO_AVAILABILITY_NOTE_MAX', async () => {
    renderOffer();
    await fillValid();
    fireEvent.change(screen.getByLabelText('When could you do it? (optional)'), {
      target: { value: 'x'.repeat(DO_AVAILABILITY_NOTE_MAX + 1) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(
      await screen.findByText(`At most ${DO_AVAILABILITY_NOTE_MAX} characters`),
    ).toBeInTheDocument();
    expect(h.callables).toHaveLength(0);
  });

  it('submits a valid offer through doSubmitOffer with the full payload', async () => {
    renderOffer();
    await fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    await waitFor(() => expect(h.callables).toHaveLength(1));
    expect(h.callables[0].name).toBe('doSubmitOffer');
    expect(h.callables[0].payload).toEqual({
      taskId: 't1',
      price: 40,
      priceBasis: 'flat',
      message: 'I can do this on Wednesday.',
      helper: null,
      availabilityNote: null,
    });
  });

  it('hides the availability note for a FIXED task (it exists for deadline/recurring/ongoing)', async () => {
    h.task = openTask({ timing: 'fixed', date: '2026-09-15', startTime: '10:00', endTime: '12:00' });
    renderOffer();
    await screen.findByText('Mount shelves');
    expect(screen.queryByLabelText('When could you do it? (optional)')).toBeNull();
  });
});

describe('OfferPage refusal mapping', () => {
  const cases: [string, RegExp][] = [
    ['task_offer_cap', /oversubscribed/],
    ['offer_cap', /maximum number of pending offers/],
    ['under_15', /at least 15/],
    ['offer_exists', /already have a live offer/],
    ['task_not_open', /no longer open/],
  ];

  for (const [reason, copy] of cases) {
    it(`maps ${reason} to its own copy`, async () => {
      h.reject = { details: { reason } };
      renderOffer();
      await fillValid();
      fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
      expect(await screen.findByText(copy)).toBeInTheDocument();
    });
  }

  it('falls back to the generic message on an unknown failure', async () => {
    h.reject = { details: {} };
    renderOffer();
    await fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(await screen.findByText('Could not send the offer. Please try again.')).toBeInTheDocument();
  });
});

describe('OfferPage editing states (§4.2)', () => {
  it('edits a PENDING offer in place via doUpdateOffer, prefilled', async () => {
    h.existingOffers = [
      {
        offerId: 'o1',
        status: 'pending',
        price: 55,
        priceBasis: 'hourly',
        message: 'Old message',
        helper: null,
        availabilityNote: 'Weekends',
      },
    ];
    renderOffer();
    expect(await screen.findByDisplayValue('55')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Old message')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.callables).toHaveLength(1));
    expect(h.callables[0].name).toBe('doUpdateOffer');
    expect((h.callables[0].payload as { offerId: string }).offerId).toBe('o1');
  });

  it('does NOT open a form over a pending_guardian offer (the §4.2 laundering pin)', async () => {
    h.existingOffers = [{ offerId: 'o1', status: 'pending_guardian', price: 55, priceBasis: 'flat', message: 'm', helper: null, availabilityNote: null }];
    renderOffer();
    expect(await screen.findByText(/with your parent for approval/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send offer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('a WITHDRAWN offer re-runs the full submit path (resurrection), prefilled from the old terms', async () => {
    h.existingOffers = [
      { offerId: 'o1', status: 'withdrawn', price: 30, priceBasis: 'flat', message: 'Old', helper: null, availabilityNote: null },
    ];
    renderOffer();
    expect(await screen.findByDisplayValue('30')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    await waitFor(() => expect(h.callables).toHaveLength(1));
    expect(h.callables[0].name).toBe('doSubmitOffer');
  });

  it('shows not-open for a task that is no longer open', async () => {
    h.task = openTask({ status: 'assigned' });
    renderOffer();
    expect(await screen.findByText('This task is no longer open for offers.')).toBeInTheDocument();
  });
});
