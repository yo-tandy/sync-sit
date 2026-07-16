import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable callable. The dialog submits via
// submitTutorEndorsement({tutorUserId, referenceText, refName, subject?}).
const h = vi.hoisted(() => ({
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ functions: {} }));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

import { EndorseTutorDialog } from '../EndorseTutorDialog';

function reset() {
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { referenceId: 'e1' } });
}

function renderDialog(props: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  const onEndorsed = vi.fn();
  renderWithProviders(
    <EndorseTutorDialog
      tutorUserId="t1"
      tutorName="Alex Roy"
      subject="math"
      defaultRefName="Dana Weiss"
      onClose={onClose}
      onEndorsed={onEndorsed}
      {...props}
    />,
  );
  return { onClose, onEndorsed };
}

const VALID_TEXT = 'Alex was patient and my daughter improved a lot.';

describe('EndorseTutorDialog', () => {
  beforeEach(() => reset());

  it('prefills refName from the caller display name and the subject from the request', () => {
    renderDialog();
    expect(screen.getByLabelText(/your name/i)).toHaveValue('Dana Weiss');
    // Subject select prefilled to 'math'.
    expect(screen.getByLabelText(/subject/i)).toHaveValue('math');
  });

  it('submits a trimmed payload with the prefilled refName and subject', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/your endorsement/i), {
      target: { value: `  ${VALID_TEXT}  ` },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('submitTutorEndorsement', {
        tutorUserId: 't1',
        referenceText: VALID_TEXT,
        refName: 'Dana Weiss',
        subject: 'math',
      }),
    );
  });

  it('omits subject from the payload when cleared', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/your endorsement/i), {
      target: { value: VALID_TEXT },
    });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => expect(h.callable).toHaveBeenCalled());
    expect(h.callable).toHaveBeenCalledWith('submitTutorEndorsement', {
      tutorUserId: 't1',
      referenceText: VALID_TEXT,
      refName: 'Dana Weiss',
    });
  });

  it('sends the edited refName', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Dana W.' } });
    fireEvent.change(screen.getByLabelText(/your endorsement/i), {
      target: { value: VALID_TEXT },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith(
        'submitTutorEndorsement',
        expect.objectContaining({ refName: 'Dana W.' }),
      ),
    );
  });

  it('blocks submit below 10 characters (client gate) and shows a message', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/your endorsement/i), {
      target: { value: 'too short' }, // 9 chars
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(h.callable).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 10|10 characters/i)).toBeInTheDocument();
  });

  it('shows the success state and notifies the parent on success', async () => {
    const { onEndorsed } = renderDialog();
    fireEvent.change(screen.getByLabelText(/your endorsement/i), {
      target: { value: VALID_TEXT },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    // Success explains it goes live only after the tutor accepts.
    expect(await screen.findByText(/after they accept|once they accept|goes live/i)).toBeInTheDocument();
    expect(onEndorsed).toHaveBeenCalled();
  });

  it.each([
    ['functions/permission-denied', /accepted contact request/i],
    ['functions/already-exists', /already endorsed/i],
    ['functions/invalid-argument', /can.?t be submitted|check the/i],
  ])('maps %s to a distinct error message', async (code, matcher) => {
    h.callable.mockRejectedValue({ code });
    renderDialog();
    fireEvent.change(screen.getByLabelText(/your endorsement/i), {
      target: { value: VALID_TEXT },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(await screen.findByText(matcher)).toBeInTheDocument();
  });

  it('treats already-exists as endorsed (notifies parent so the row updates)', async () => {
    h.callable.mockRejectedValue({ code: 'functions/already-exists' });
    const { onEndorsed } = renderDialog();
    fireEvent.change(screen.getByLabelText(/your endorsement/i), {
      target: { value: VALID_TEXT },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await screen.findByText(/already endorsed/i);
    expect(onEndorsed).toHaveBeenCalled();
  });
});
