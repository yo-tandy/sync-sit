import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the props the do LoginPage passes into the shared LoginPage.
let captured: Record<string, unknown> = {};
vi.mock('@ejm/shared-ui', () => ({
  LoginPage: (props: Record<string, unknown>) => {
    captured = props;
    return null;
  },
}));

// The wrapper reads useAuthStore() for {login,loading,error,clearError}.
vi.mock('@/stores/authStore', () => {
  const state = { login: vi.fn(), loading: false, error: null, clearError: vi.fn(), userDoc: null };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

// The wrapper reads useTranslation() for i18n.language (issue #435
// milestone, PR5: signUpTo carries the current language cross-origin).
// Stubbed rather than pulling in the real i18n singleton, same as the two
// mocks above — this test isolates the wrapper's own logic.
let mockLanguage = 'en';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: mockLanguage } }),
}));

import { render } from '@testing-library/react';
import { LoginPage } from '../LoginPage';

describe('do LoginPage wrapper', () => {
  beforeEach(() => {
    mockLanguage = 'en';
  });

  it('passes Sync/Do branding', () => {
    render(<LoginPage />);
    expect(captured.logoAlt).toBe('Sync/Do');
  });

  // issue #435 milestone, PR5: do's own role question is retired — the
  // "create an account" link goes straight to sit's cross-origin /enroll,
  // not through do's local /signup redirect hop.
  it('points signUpTo at sit\'s cross-origin /enroll, carrying the current language', () => {
    render(<LoginPage />);
    expect(captured.signUpTo).toBe('https://sync-sit.com/enroll?lang=en');

    mockLanguage = 'fr';
    render(<LoginPage />);
    expect(captured.signUpTo).toBe('https://sync-sit.com/enroll?lang=fr');
  });
});
