import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));

import i18n from '@/i18n';
import { AppSwitchInlineHost } from '../AppSwitchInlineHost';

/**
 * The desktop counterpart to AppSwitchBarHost.test.tsx (#417, plan Q9).
 * Study's half of the decision-20 gate: the shared component can hide a
 * tab; this proves study's actual inline switcher does (#304).
 */
describe('AppSwitchInlineHost (study)', () => {
  afterEach(() => cleanup());

  const renderHost = (path = '/family') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <I18nextProvider i18n={i18n}>
          <AppSwitchInlineHost accountHref="/family/account" homeHref="/family" />
        </I18nextProvider>
      </MemoryRouter>,
    );

  it('offers sync/sit and the account entry', () => {
    renderHost();
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my account/i })).toBeInTheDocument();
  });

  it('does NOT offer sync/do — decision 20, flipped by #304', () => {
    renderHost();
    expect(screen.queryByRole('button', { name: /sync\/do/ })).toBeNull();
  });

  it('is hidden md:flex — visible only at md+', () => {
    renderHost();
    const nav = screen.getByRole('navigation', { name: /switch app/i });
    expect(nav.className).toMatch(/\bhidden\b/);
    expect(nav.className).toMatch(/\bmd:flex\b/);
  });
});
