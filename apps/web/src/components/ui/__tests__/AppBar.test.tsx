import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));
vi.mock('@/stores/authStore', () => {
  const state = {
    userDoc: { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' },
    logout: vi.fn(),
  };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import i18n from '@/i18n';
import { AppBar } from '../AppBar';
import type { UserRole } from '@ejm/sit-core';

function openMenu(role: UserRole) {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AppBar role={role} />
      </MemoryRouter>
    </I18nextProvider>,
  );
  // The burger is the only button in the closed bar.
  fireEvent.click(screen.getAllByRole('button')[0]);
}

describe('AppBar switch entry', () => {
  it.each(['babysitter', 'parent', 'admin'] as const)(
    'shows the sync-study switch entry in the %s menu',
    (role) => {
      openMenu(role);
      expect(screen.getByRole('button', { name: /open sync-study/i })).toBeInTheDocument();
      cleanup();
    },
  );
});
