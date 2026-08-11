import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));

const authState = { firebaseUser: { uid: 'admin-1' } as unknown };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}));

import i18n from '@/i18n';
import { AdminInfoPage } from '../AdminInfoPage';

describe('AdminInfoPage', () => {
  afterEach(cleanup);

  // Admins bounced here (no study admin portal exists) must get an
  // explanation and a working switch back to sync-sit — not a dead end.
  it('explains that administration lives in sync-sit and offers the switch back', () => {
    i18n.changeLanguage('en');
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AdminInfoPage />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText(/administration lives in sync-sit/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open sync-sit/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to home/i })).toBeInTheDocument();
  });

  it('renders the real French translation when the language is fr', () => {
    i18n.changeLanguage('fr');
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AdminInfoPage />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText(/L’administration se trouve dans sync-sit/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Retour à l’accueil/ })).toBeInTheDocument();
    i18n.changeLanguage('en');
  });

  it('shows a login link instead of the switch for signed-out visitors', () => {
    i18n.changeLanguage('en');
    authState.firebaseUser = null;
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AdminInfoPage />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.queryByRole('button', { name: /open sync-sit/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to login|log ?in/i })).toBeInTheDocument();
    authState.firebaseUser = { uid: 'admin-1' };
  });
});
