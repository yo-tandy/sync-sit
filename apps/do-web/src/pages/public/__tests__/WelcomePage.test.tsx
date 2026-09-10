import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';

const authState: { firebaseUser: unknown; userDoc: unknown; loading: boolean } = {
  firebaseUser: null,
  userDoc: null,
  loading: false,
};
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => authState;
  useAuthStore.getState = () => authState;
  return { useAuthStore };
});

import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { WelcomePage } from '../WelcomePage';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  authState.firebaseUser = null;
  authState.userDoc = null;
  authState.loading = false;
});

// issue #435 milestone, PR5: do's own role question is retired — the CTA
// points straight at sit's cross-origin /enroll, not /signup.
describe('WelcomePage (do)', () => {
  it('renders the brand title and points "Sign up" at sit\'s cross-origin /enroll', () => {
    renderWithProviders(<WelcomePage />);

    expect(screen.getByRole('heading', { name: 'Sync/Do' })).toBeInTheDocument();

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('https://sync-sit.com/enroll?lang=en');
    expect(hrefs).not.toContain('/signup');
  });
});
