import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/render.js';
import { StepParentEmail } from '../StepParentEmail.js';

afterEach(cleanup);

function setup(overrides: Partial<React.ComponentProps<typeof StepParentEmail>> = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const props = { email: '', onChange, onSubmit, loading: false, error: null, ...overrides };
  const view = renderWithProviders(<StepParentEmail {...props} />);
  return { onChange, onSubmit, view };
}

describe('StepParentEmail', () => {
  it('accepts ANY domain — parents are not EJM members (no school-domain gate like StepEmail)', () => {
    const { onSubmit } = setup({ email: 'claire@gmail.com' });
    expect(screen.queryByText('Enter a valid email address')).toBeNull();
    const button = screen.getByRole('button', { name: 'Send verification code' });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a malformed address shows the validation copy and disables submit', () => {
    const { onSubmit } = setup({ email: 'not-an-email' });
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send verification code' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Send verification code' }).closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is controlled: typing reports the raw value through onChange', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText('Email address *'), { target: { value: 'A@B.co' } });
    expect(onChange).toHaveBeenCalledWith('A@B.co');
  });

  it('shows the busy label and blocks a second submit while loading', () => {
    const { onSubmit } = setup({ email: 'claire@gmail.com', loading: true });
    const button = screen.getByRole('button', { name: 'Sending...' });
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders the orchestrator's error under the field, verbatim (no auth-failure rewrite)", () => {
    setup({ email: 'claire@gmail.com', error: 'Must be logged in' });
    // verifyParentEmail is unauthenticated by design, so there is nothing to
    // translate this into — it is shown as handed down.
    expect(screen.getByText('Must be logged in')).toBeInTheDocument();
  });

  it('renders the host logo only when given', () => {
    const { view } = setup({ logoSrc: '/logo.png', logoAlt: 'Sync/Sit' });
    expect(screen.getByAltText('Sync/Sit')).toHaveAttribute('src', '/logo.png');
    view.unmount();
    setup();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
