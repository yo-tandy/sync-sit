import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';

// The wrapper now reads useAuthStore() to decide whether to show the cross-app
// banner. Mock it (mutable state; defaults to unauthenticated) so the existing
// render tests don't pull in the real firebase-backed store.
const authState: { firebaseUser: unknown; userDoc: unknown } = {
  firebaseUser: null,
  userDoc: null,
};
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => authState;
  useAuthStore.getState = () => authState;
  return { useAuthStore };
});

import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { SignUpRolePage } from '../SignUpRolePage';

const BANNER = /pick a role to add to your existing account/i;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  authState.firebaseUser = null;
  authState.userDoc = null;
});

describe('SignUpRolePage (study)', () => {
  it('offers Tutor and Parent (not Babysitter) with the right enroll links', () => {
    renderWithProviders(<SignUpRolePage />);

    const hrefs = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/enroll/tutor');
    expect(hrefs).toContain('/enroll/parent');

    // The tutor role card label, and no babysitter anywhere.
    expect(screen.getByText('Tutor')).toBeInTheDocument();
    expect(screen.queryByText(/Babysitter/i)).toBeNull();
  });

  it('shows the cross-app banner for a signed-in foreign-profile-only user', () => {
    authState.firebaseUser = { uid: 'u1' };
    authState.userDoc = { profiles: { babysitter: { enrollmentComplete: true } } };
    renderWithProviders(<SignUpRolePage />);
    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it('shows no banner for an unauthenticated visitor', () => {
    renderWithProviders(<SignUpRolePage />);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('shows no banner for a signed-in user who already has a study role', () => {
    authState.firebaseUser = { uid: 'u2' };
    authState.userDoc = { profiles: { tutor: { enrollmentComplete: true } } };
    renderWithProviders(<SignUpRolePage />);
    expect(screen.queryByText(BANNER)).toBeNull();
  });
});
