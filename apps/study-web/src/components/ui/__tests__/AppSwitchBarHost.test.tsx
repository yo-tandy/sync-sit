import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));

import i18n from '@/i18n';
import { AppSwitchBarHost } from '../AppSwitchBarHost';

/**
 * Study's half of the decision-20 gate. The shared bar can hide a tab; this
 * proves study's actual bar does (#365, #304).
 */
describe('AppSwitchBarHost (study)', () => {
  afterEach(() => cleanup());

  const renderHost = (path = '/family') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <I18nextProvider i18n={i18n}>
          <AppSwitchBarHost accountHref="/family/account" />
        </I18nextProvider>
      </MemoryRouter>,
    );

  it('offers sync/sit and the account tab', () => {
    renderHost();
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my account/i })).toBeInTheDocument();
  });

  it('does NOT offer sync/do — decision 20, flipped by #304', () => {
    renderHost();
    expect(screen.queryByRole('button', { name: /sync\/do/ })).toBeNull();
  });
});
