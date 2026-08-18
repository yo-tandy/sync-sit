import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

vi.mock('@/config/firebase', () => ({ auth: {}, db: {}, functions: {}, storage: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));
vi.mock('@/stores/authStore', () => {
  const state = {
    userDoc: { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' },
    firebaseUser: { uid: 't1' },
    logout: vi.fn(),
  };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { renderWithProviders } from '@/__tests__/test-utils';
import { AppBar } from '../AppBar';

/**
 * Issue #165 relegated the dashboard's tile grid to the hamburger menu:
 * endorsements, subjects & rates and account (plus the requests, sessions and
 * schedule tiles the sections/availability box replaced). Every surface the
 * dashboard no longer links must stay reachable from the menu — these pins
 * keep the menu from orphaning any of them.
 */
describe('AppBar menu covers every surface removed from the dashboard', () => {
  const entries: [RegExp, string][] = [
    [/^endorsements$/i, '/tutor/endorsements'],
    [/^subjects & rates$/i, '/tutor/subjects'],
    [/^my account$/i, '/tutor/account'],
    [/^requests$/i, '/tutor/requests'],
    [/^sessions$/i, '/tutor/sessions'],
    [/^schedule$/i, '/tutor/schedule'],
  ];

  it.each(entries)('menu entry %s links to %s', (name, href) => {
    renderWithProviders(<AppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    const link = screen.getByRole('link', { name });
    expect(link).toHaveAttribute('href', href);
  });
});
