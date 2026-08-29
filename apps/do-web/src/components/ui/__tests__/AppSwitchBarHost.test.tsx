import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));

import i18n from '@/i18n';
import { AppSwitchBarHost } from '../AppSwitchBarHost';

/**
 * do-web's bar is the asymmetric one, and both asymmetries are deliberate
 * (#365, plan §18.2 and §18.3). Pinned because both read as bugs otherwise.
 */
describe('AppSwitchBarHost (do)', () => {
  afterEach(() => cleanup());

  const renderHost = () =>
    render(
      <MemoryRouter initialEntries={['/doer']}>
        <I18nextProvider i18n={i18n}>
          <AppSwitchBarHost homeHref="/doer" />
        </I18nextProvider>
      </MemoryRouter>,
    );

  it('offers BOTH siblings — decision 20 gates linking TO do, not FROM it', () => {
    renderHost();
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sync\/study/ })).toBeInTheDocument();
  });

  it('renders NO account tab — do-web ships no account page (§18.3)', () => {
    // The shared hub owns identity; do contributes only a doer-settings
    // screen reached from a row in it. Until #367 exists there is no route
    // here to point at. Passing accountHref is the whole change then.
    renderHost();
    expect(screen.queryByRole('button', { name: /my account/i })).toBeNull();
  });
});
