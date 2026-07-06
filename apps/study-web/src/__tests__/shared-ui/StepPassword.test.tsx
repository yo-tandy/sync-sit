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
    // No password inputs rendered
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
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
});
