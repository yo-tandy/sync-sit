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

const HIT_TARGET = /\bh-11\b[\s\S]*\bw-11\b|\bw-11\b[\s\S]*\bh-11\b/;

describe('app bar hit targets (≥44px, WCAG 2.5.8)', () => {
  it('tutor bar: home link and menu button are 44px targets with accessible names', () => {
    renderWithProviders(<AppBar />);
    expect(screen.getByRole('link', { name: /home/i }).className).toMatch(HIT_TARGET);
    expect(screen.getByRole('button', { name: /open menu/i }).className).toMatch(HIT_TARGET);
  });

  it('family bar: home link and menu button are 44px targets with accessible names', () => {
    renderWithProviders(<FamilyAppBar />);
    expect(screen.getByRole('link', { name: /home/i }).className).toMatch(HIT_TARGET);
    expect(screen.getByRole('button', { name: /open menu/i }).className).toMatch(HIT_TARGET);
  });
});
