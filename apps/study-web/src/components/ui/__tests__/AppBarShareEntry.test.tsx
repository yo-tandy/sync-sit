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

/**
 * Entry-point pins for the share flow: both portal menus expose a
 * "Share Sync/Study" item routed to /share, mirroring sync-sit's AppBar entry.
 */
describe('app bar share entries', () => {
  it('shows the share entry in the tutor menu, linking to /share', () => {
    renderWithProviders(<AppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    const link = screen.getByRole('link', { name: /share sync\/study/i });
    expect(link).toHaveAttribute('href', '/share');
  });

  it('shows the share entry in the family menu, linking to /share', () => {
    renderWithProviders(<FamilyAppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    const link = screen.getByRole('link', { name: /share sync\/study/i });
    expect(link).toHaveAttribute('href', '/share');
  });
});
