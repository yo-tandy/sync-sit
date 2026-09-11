import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/render.js';
import { DeleteAccountSection } from '../DeleteAccountSection.js';

afterEach(cleanup);

/** A rejection shaped like the Firebase client SDK's FunctionsError. */
function functionsError(code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error('server message'), { code: `functions/${code}`, details });
}

function setup(overrides?: {
  onDeleteAccount?: () => Promise<void>;
  onSignOut?: () => void | Promise<void>;
  onDeleted?: () => void;
}) {
  const onSignOut = overrides?.onSignOut ?? vi.fn();
  const onDeleteAccount = overrides?.onDeleteAccount ?? vi.fn().mockResolvedValue(undefined);
  const onDeleted = overrides?.onDeleted ?? vi.fn();
  renderWithProviders(
    <DeleteAccountSection
      onSignOut={onSignOut}
      onDeleteAccount={onDeleteAccount}
      onDeleted={onDeleted}
    />,
  );
  return { onSignOut, onDeleteAccount, onDeleted };
}

describe('DeleteAccountSection', () => {
  it('renders sign out and delete my account rows', () => {
    setup();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
    expect(screen.getByText('Delete my account')).toBeInTheDocument();
  });

  it('sign out needs no confirmation — it calls onSignOut directly', () => {
    const { onSignOut, onDeleteAccount } = setup();
    fireEvent.click(screen.getByText('Sign out'));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onDeleteAccount).not.toHaveBeenCalled();
    // No dialog opened for sign-out.
    expect(screen.queryByText('Delete my account?')).toBeNull();
  });

  it('opens a dialog explaining the erasure, with the delete button disabled until the word matches', () => {
    setup();
    fireEvent.click(screen.getByText('Delete my account'));
    expect(screen.getByText('Delete my account?')).toBeInTheDocument();
    expect(screen.getByText(/removed from sync\/sit, sync\/study and sync\/do/)).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: 'Yes, delete my account' });
    expect(confirmButton).toBeDisabled();

    const input = screen.getByLabelText('Type DELETE to confirm');
    fireEvent.change(input, { target: { value: 'delete' } });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(input, { target: { value: 'DELETE' } });
    expect(confirmButton).not.toBeDisabled();
  });

  it('cancel closes the dialog and clears the typed word', () => {
    setup();
    fireEvent.click(screen.getByText('Delete my account'));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete my account?')).toBeNull();

    fireEvent.click(screen.getByText('Delete my account'));
    expect(screen.getByLabelText('Type DELETE to confirm')).toHaveValue('');
  });

  it('calls the callable exactly once, then signs out, then navigates on success', async () => {
    const { onSignOut, onDeleteAccount, onDeleted } = setup();
    fireEvent.click(screen.getByText('Delete my account'));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('a sign-out failure AFTER a successful delete still navigates, with no error copy shown (review round 1)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSignOut = vi.fn().mockRejectedValue(new Error('network dropped'));
    const { onDeleted } = setup({ onSignOut });
    fireEvent.click(screen.getByText('Delete my account'));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    // The account is already gone at this point -- a sign-out failure must
    // never read as a delete failure, and must never re-open/re-enable a
    // dialog for an account that no longer exists.
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      '[account] sign-out after deletion failed',
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it('maps admin/last-admin to its own copy and keeps the dialog open', async () => {
    const onDeleteAccount = vi
      .fn()
      .mockRejectedValue(functionsError('failed-precondition', { code: 'admin/last-admin' }));
    const { onSignOut, onDeleted } = setup({ onDeleteAccount });
    fireEvent.click(screen.getByText('Delete my account'));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(
      await screen.findByText("You're the last admin. Appoint another admin before deleting your account."),
    ).toBeInTheDocument();
    expect(screen.getByText('Delete my account?')).toBeInTheDocument();
    expect(onSignOut).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('maps a stale re-auth window (failed-precondition, no details) to its own copy', async () => {
    const onDeleteAccount = vi.fn().mockRejectedValue(functionsError('failed-precondition'));
    setup({ onDeleteAccount });
    fireEvent.click(screen.getByText('Delete my account'));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(
      await screen.findByText('For your security, please sign in again before deleting your account.'),
    ).toBeInTheDocument();
  });

  it('falls back to the generic failure copy for anything else, and keeps the dialog open', async () => {
    const onDeleteAccount = vi.fn().mockRejectedValue(functionsError('internal'));
    const { onDeleted } = setup({ onDeleteAccount });
    fireEvent.click(screen.getByText('Delete my account'));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.getByText('Delete my account?')).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
