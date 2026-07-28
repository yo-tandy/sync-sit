import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReasonModal, type ReasonModalProps } from '../ReasonModal';

function props(overrides: Partial<ReasonModalProps> = {}): ReasonModalProps {
  return {
    open: true,
    title: 'Cancel this session?',
    description: 'Let them know why.',
    placeholder: 'Reason',
    confirmLabel: 'Confirm cancellation',
    keepLabel: 'Keep it',
    submitting: false,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('ReasonModal warning prop', () => {
  it('renders the warning above the reason field when provided', () => {
    render(<ReasonModal {...props({ warning: 'This is a late cancellation.' })} />);
    expect(screen.getByText('This is a late cancellation.')).toBeInTheDocument();
  });

  it('renders no warning text when the prop is absent', () => {
    render(<ReasonModal {...props()} />);
    expect(screen.queryByText(/late cancellation/i)).not.toBeInTheDocument();
  });

  it('still gates confirm on a ≥3-char reason regardless of the warning', () => {
    const onConfirm = vi.fn();
    render(<ReasonModal {...props({ warning: 'heads up', onConfirm })} />);

    const confirm = screen.getByRole('button', { name: /confirm cancellation/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'busy' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('busy');
  });
});
