import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';

vi.mock('@/config/firebase', () => ({ functions: {} }));
const h = vi.hoisted(() => ({ mint: vi.fn(), assign: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => () => h.mint() }));

import i18n from '@/i18n';
import { SIT_APP_URL } from '@/utils/appSwitch';
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

  it('"My account" hands off to the ONE account hub on sync-sit (next=/account)', async () => {
    h.mint.mockResolvedValueOnce({ data: { code: 'c1' } });
    h.assign.mockReset();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...original, assign: h.assign, hash: '' },
      writable: true,
      configurable: true,
    });
    try {
      renderHost();
      const tab = screen.getByRole('button', { name: /my account/i });
      expect(tab).not.toHaveAttribute('aria-current');
      fireEvent.click(tab);
      await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
      expect(h.assign).toHaveBeenCalledWith(`${SIT_APP_URL}/handoff#code=c1&lang=en&next=%2Faccount`);
    } finally {
      Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true });
    }
  });

  it('is hidden md:flex — visible only at md+', () => {
    renderHost();
    const nav = screen.getByRole('navigation', { name: /switch app/i });
    expect(nav.className).toMatch(/\bhidden\b/);
    expect(nav.className).toMatch(/\bmd:flex\b/);
  });
});
