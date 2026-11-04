import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/render.js';
import { ConsentGate } from '../ConsentGate.js';

afterEach(cleanup);

function functionsError(code: string, details?: Record<string, unknown>) {
  return Object.assign(new Error('server message'), { code: `functions/${code}`, details });
}

function setup(overrides?: {
  onAccept?: (v: string) => Promise<void>;
  onSignOut?: () => void;
  termsHref?: string;
  privacyHref?: string;
}) {
  const onAccept = overrides?.onAccept ?? vi.fn().mockResolvedValue(undefined);
  const onSignOut = overrides?.onSignOut ?? vi.fn();
  renderWithProviders(
    <ConsentGate
      consentVersion="1.0"
      onAccept={onAccept}
      onSignOut={onSignOut}
      termsHref={overrides?.termsHref}
      privacyHref={overrides?.privacyHref}
    />,
  );
  return { onAccept, onSignOut };
}

const accept = () => screen.getByRole('button', { name: 'Accept and continue' });

describe('ConsentGate', () => {
  it('renders the update copy and links to both documents at the default routes, opening in a new tab', () => {
    setup();
    expect(screen.getByRole('heading', { name: "We've updated our terms" })).toBeInTheDocument();
    const terms = screen.getAllByRole('link', { name: 'Terms of Service' });
    const privacy = screen.getAllByRole('link', { name: 'Privacy Policy' });
    expect(terms.length).toBeGreaterThan(0);
    for (const l of [...terms, ...privacy]) expect(l).toHaveAttribute('target', '_blank');
    expect(terms[0]).toHaveAttribute('href', '/terms');
    expect(privacy[0]).toHaveAttribute('href', '/privacy');
  });

  it('respects custom document routes', () => {
    setup({ termsHref: '/legal/terms', privacyHref: '/legal/privacy' });
    expect(screen.getAllByRole('link', { name: 'Terms of Service' })[0]).toHaveAttribute('href', '/legal/terms');
    expect(screen.getAllByRole('link', { name: 'Privacy Policy' })[0]).toHaveAttribute('href', '/legal/privacy');
  });

  it('keeps Accept disabled until the box is ticked, then calls onAccept with the presented version', async () => {
    const { onAccept } = setup();
    expect(accept()).toBeDisabled();
    fireEvent.click(accept());
    expect(onAccept).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(accept()).toBeEnabled();
    fireEvent.click(accept());
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith('1.0'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('stays busy after a successful accept (the host unmounts it) -- a second tap does not double-write', async () => {
    const { onAccept } = setup();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(accept());
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
    expect(accept()).toBeDisabled();
    fireEvent.click(accept());
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("maps consent/stale-client to the reload copy and re-enables Accept", async () => {
    setup({
      onAccept: vi.fn().mockRejectedValue(
        functionsError('failed-precondition', { code: 'consent/stale-client', current: '2.0' }),
      ),
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(accept());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This app is out of date. Reload the page and try again.',
    );
    expect(accept()).toBeEnabled();
  });

  it('maps any other failure to the generic error copy', async () => {
    setup({ onAccept: vi.fn().mockRejectedValue(functionsError('unavailable')) });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(accept());
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
  });

  it('offers sign-out as the way out for a member who declines', () => {
    const { onSignOut, onAccept } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out instead' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });
});
