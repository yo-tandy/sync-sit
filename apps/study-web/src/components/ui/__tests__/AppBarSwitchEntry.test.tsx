import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

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

import { renderWithProviders } from '@/__tests__/test-utils';
import { AppBar } from '../AppBar';
import { FamilyAppBar } from '../FamilyAppBar';

describe('app bar switch entries', () => {
  it('shows the sync-sit switch entry in the tutor menu', () => {
    renderWithProviders(<AppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByRole('button', { name: /open sync-sit/i })).toBeInTheDocument();
  });

  it('shows the sync-sit switch entry in the family menu', () => {
    renderWithProviders(<FamilyAppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByRole('button', { name: /open sync-sit/i })).toBeInTheDocument();
  });
});
