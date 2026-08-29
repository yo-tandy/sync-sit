import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { StepPassword } from '@ejm/shared-ui';
import { renderWithProviders } from '../test-utils';

describe('StepPassword collectPassword=false', () => {
  it('hides password inputs, submits with consent only', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <StepPassword onSubmit={onSubmit} consentVersion="1.0" loading={false} error={null} collectPassword={false} />,
    );
    // No password inputs rendered; consent-only heading resolves from i18n
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: /almost there/i })).toBeInTheDocument();
    // Submit disabled until consent checked
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('', '1.0'));
  });

  it('default mode still renders password inputs', () => {
    renderWithProviders(
      <StepPassword onSubmit={vi.fn()} consentVersion="1.0" loading={false} error={null} />,
    );
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2);
  });

  it('clears a partly-typed password when the wizard flips to consent-only, so flipping back starts empty', () => {
    // Wizards resolve auth state asynchronously, so collectPassword can flip
    // after mount — stale input must not resurface when it flips back.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderWithProviders(
      <StepPassword onSubmit={onSubmit} consentVersion="1.0" loading={false} error={null} />,
    );
    const inputs = () => document.querySelectorAll<HTMLInputElement>('input[type="password"]');
    fireEvent.change(inputs()[0], { target: { value: 'Partly-typed1' } });
    fireEvent.change(inputs()[1], { target: { value: 'Partly-typed1' } });
    expect(inputs()[0].value).toBe('Partly-typed1');

    rerender(
      <StepPassword
        onSubmit={onSubmit}
        consentVersion="1.0"
        loading={false}
        error={null}
        collectPassword={false}
      />,
    );
    expect(inputs()).toHaveLength(0);

    rerender(
      <StepPassword onSubmit={onSubmit} consentVersion="1.0" loading={false} error={null} />,
    );
    expect(inputs()[0].value).toBe('');
    expect(inputs()[1].value).toBe('');
  });
});
