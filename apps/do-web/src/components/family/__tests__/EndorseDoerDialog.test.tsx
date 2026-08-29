import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { DO_ENDORSEMENT_TEXT_MIN } from '@ejm/do-core';

/**
 * The family's §9.1 endorsement form. Pins:
 * - the payload shape doSubmitEndorsement validates, with the body TRIMMED
 *   (the callable stores the trimmed string, and the client floor is
 *   measured the same way);
 * - the client floor pre-empts the round trip — no callable fires;
 * - `already-exists` settles the caller (retrying can only fail again) and
 *   gets its own copy;
 * - `no_completed_task` gets the eligibility line, not "something went
 *   wrong" — the family needs to know what to do, not to retry a form that
 *   cannot succeed;
 * - the success state says the endorsement is PRIVATE until accepted, so it
 *   never implies it is already live.
 */

const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  error: null as { code?: string; details?: { reason?: string } } | null,
}));

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    return h.error ? Promise.reject(h.error) : Promise.resolve({ data: { referenceId: 'r1' } });
  },
}));

import { EndorseDoerDialog } from '../EndorseDoerDialog';

const GOOD_TEXT = 'Assembled the PAX in an afternoon and cleaned up after.';

function render(onEndorsed = vi.fn(), onClose = vi.fn()) {
  renderWithProviders(
    <EndorseDoerDialog
      doerUserId="doer1"
      doerName="Emma"
      defaultRefName="Marie Dupont"
      onClose={onClose}
      onEndorsed={onEndorsed}
    />,
  );
  return { onEndorsed, onClose };
}

function fillBody(text: string) {
  fireEvent.change(screen.getByLabelText('Your endorsement'), { target: { value: text } });
}

beforeEach(() => {
  h.calls = [];
  h.error = null;
});

describe('EndorseDoerDialog', () => {
  it('submits the doSubmitEndorsement payload with the body trimmed', async () => {
    const { onEndorsed } = render();
    fillBody(`   ${GOOD_TEXT}   `);
    fireEvent.click(screen.getByRole('button', { name: 'Send endorsement' }));
    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(h.calls[0]).toEqual({
      name: 'doSubmitEndorsement',
      payload: { doerUserId: 'doer1', referenceText: GOOD_TEXT, refName: 'Marie Dupont' },
    });
    expect(onEndorsed).toHaveBeenCalled();
  });

  it('says the endorsement stays private until the student accepts', async () => {
    render();
    fillBody(GOOD_TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Send endorsement' }));
    await waitFor(() => expect(screen.getByText('Endorsement sent')).toBeInTheDocument());
    expect(screen.getByText(/will be asked to accept it/)).toBeInTheDocument();
  });

  // The client floor pre-empts the round trip (plan §8's rule for do forms):
  // a too-short body must never reach the callable.
  it('refuses a too-short body client-side, with NO callable fired', () => {
    render();
    fillBody('a'.repeat(DO_ENDORSEMENT_TEXT_MIN - 1));
    fireEvent.click(screen.getByRole('button', { name: 'Send endorsement' }));
    expect(h.calls).toHaveLength(0);
    expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument();
  });

  it('refuses whitespace-only text the same way the server would', () => {
    render();
    fillBody('              ');
    fireEvent.click(screen.getByRole('button', { name: 'Send endorsement' }));
    expect(h.calls).toHaveLength(0);
  });

  it('refuses an empty display name client-side', () => {
    render();
    fillBody(GOOD_TEXT);
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send endorsement' }));
    expect(h.calls).toHaveLength(0);
    expect(screen.getByText(/name families should see/)).toBeInTheDocument();
  });

  it('maps already-exists to its own copy AND settles the caller', async () => {
    h.error = { code: 'functions/already-exists' };
    const { onEndorsed } = render();
    fillBody(GOOD_TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Send endorsement' }));
    await waitFor(() =>
      expect(screen.getByText(/already endorsed this student/)).toBeInTheDocument(),
    );
    // Settled: retrying can only hit the same refusal, so the caller hides
    // its CTA rather than inviting a doomed second attempt.
    expect(onEndorsed).toHaveBeenCalled();
  });

  it('maps the no_completed_task reason to the eligibility line, not the generic error', async () => {
    h.error = { code: 'functions/permission-denied', details: { reason: 'no_completed_task' } };
    render();
    fillBody(GOOD_TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Send endorsement' }));
    await waitFor(() =>
      expect(screen.getByText(/once a task you assigned them is completed/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Could not send the endorsement. Please try again.')).toBeNull();
  });

  it('falls back to the generic copy for an unmapped failure, form still usable', async () => {
    h.error = { code: 'functions/internal' };
    render();
    fillBody(GOOD_TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Send endorsement' }));
    await waitFor(() =>
      expect(screen.getByText(/Could not send the endorsement/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Send endorsement' })).toBeEnabled();
  });
});
