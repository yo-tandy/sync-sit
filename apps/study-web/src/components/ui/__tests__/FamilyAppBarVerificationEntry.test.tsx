import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

vi.mock('@/config/firebase', () => ({ db: {}, functions: {}, auth: {} }));
vi.mock('@/stores/authStore', () => {
  const state = {
    userDoc: { firstName: 'Dana', lastName: 'W', email: 'd@x.com' },
    logout: vi.fn(),
  };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { FamilyAppBar } from '../FamilyAppBar';

describe('FamilyAppBar verification entry', () => {
  // The menu entry is how a VERIFIED family reaches approve-a-friend — the
  // dashboard banner only shows while unverified (issue #129).
  it('exposes Verification linking /family/verification', () => {
    renderWithProviders(<FamilyAppBar />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    // #119 renders the same list as md+ tabs too — scope to the burger dialog.
    const link = within(screen.getByRole('dialog')).getByRole('link', { name: /Verification/i });
    expect(link).toHaveAttribute('href', '/family/verification');
  });
});
