import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));

import i18n from '@/i18n';
import { AppSwitchInlineHost } from '../AppSwitchInlineHost';

/**
 * The desktop counterpart to AppSwitchBarHost.test.tsx (#417, plan Q9). The
 * decision-20 gate lives at the SAME call site as the bar's -- sit's host
 * passes only `study` as a sibling -- so it has to be pinned here too, not
 * just against the shared `AppSwitchInline` component's own prop contract.
 */
describe('AppSwitchInlineHost (sit)', () => {
  afterEach(() => cleanup());

  const renderHost = (path = '/family', props: Partial<React.ComponentProps<typeof AppSwitchInlineHost>> = {}) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <I18nextProvider i18n={i18n}>
          <AppSwitchInlineHost accountHref="/family/account" homeHref="/family" {...props} />
        </I18nextProvider>
      </MemoryRouter>,
    );

  it('offers sync/study and the account entry', () => {
    renderHost();
    expect(screen.getByRole('button', { name: /sync\/study/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my account/i })).toBeInTheDocument();
  });

  it('does NOT offer sync/do — decision 20, flipped by #304', () => {
    renderHost();
    expect(screen.queryByRole('button', { name: /sync\/do/ })).toBeNull();
  });

  it('marks the account entry active only on the account route', () => {
    renderHost('/family/account');
    expect(screen.getByRole('button', { name: /my account/i })).toHaveAttribute('aria-current', 'page');
    cleanup();
    renderHost('/family');
    expect(screen.getByRole('button', { name: /my account/i })).not.toHaveAttribute('aria-current');
  });

  it('omits the account entry when accountHref is not supplied — admin’s sidebar-head shape', () => {
    renderHost('/admin', { accountHref: undefined, homeHref: '/admin' });
    expect(screen.queryByRole('button', { name: /my account/i })).toBeNull();
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toBeInTheDocument();
  });

  it('is hidden md:flex — visible only at md+', () => {
    renderHost();
    const nav = screen.getByRole('navigation', { name: /switch app/i });
    expect(nav.className).toMatch(/\bhidden\b/);
    expect(nav.className).toMatch(/\bmd:flex\b/);
  });
});
