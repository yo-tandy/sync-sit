import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));

import i18n from '@/i18n';
import { AppSwitchBarHost } from '../AppSwitchBarHost';

/**
 * The decision-20 gate lives at THIS call site, not inside the shared bar --
 * that was deliberate (#365), so it has to be pinned here too. A test of the
 * component alone proves the bar can hide a tab; only this proves sit's
 * actual bar does.
 */
describe('AppSwitchBarHost (sit)', () => {
  afterEach(() => cleanup());

  const renderHost = (path = '/family') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <I18nextProvider i18n={i18n}>
          <AppSwitchBarHost accountHref="/family/account" homeHref="/family" />
        </I18nextProvider>
      </MemoryRouter>,
    );

  it('offers sync/study and the account tab', () => {
    renderHost();
    expect(screen.getByRole('button', { name: /sync\/study/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my account/i })).toBeInTheDocument();
  });

  it('does NOT offer sync/do — decision 20, flipped by #304', () => {
    // If this fails, sync-do became reachable from sit without the owner
    // approving it. That is the whole point of the gate.
    renderHost();
    expect(screen.queryByRole('button', { name: /sync\/do/ })).toBeNull();
  });

  it('marks the account tab active only on the account route', () => {
    renderHost('/family/account');
    expect(screen.getByRole('button', { name: /my account/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    cleanup();
    renderHost('/family');
    expect(screen.getByRole('button', { name: /my account/i })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
