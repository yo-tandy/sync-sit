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
 * do-web's switcher is the asymmetric one, and both asymmetries are
 * deliberate (plan §18.2 and §18.3) -- pinned here too, not just against
 * the bar.
 */
describe('AppSwitchInlineHost (do)', () => {
  afterEach(() => cleanup());

  const renderHost = () =>
    render(
      <MemoryRouter initialEntries={['/doer']}>
        <I18nextProvider i18n={i18n}>
          <AppSwitchInlineHost homeHref="/doer" />
        </I18nextProvider>
      </MemoryRouter>,
    );

  it('offers BOTH siblings — decision 20 gates linking TO do, not FROM it', () => {
    renderHost();
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sync\/study/ })).toBeInTheDocument();
  });

  it('renders NO account entry — do-web ships no account page (§18.3)', () => {
    renderHost();
    expect(screen.queryByRole('button', { name: /my account/i })).toBeNull();
  });

  it('is hidden md:flex — visible only at md+', () => {
    renderHost();
    const nav = screen.getByRole('navigation', { name: /switch app/i });
    expect(nav.className).toMatch(/\bhidden\b/);
    expect(nav.className).toMatch(/\bmd:flex\b/);
  });
});
