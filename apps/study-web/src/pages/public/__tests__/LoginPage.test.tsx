import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the props the study LoginPage passes into the shared LoginPage.
let captured: Record<string, unknown> = {};
vi.mock('@ejm/shared-ui', () => ({
  // Layout-only column (issue #528): pass children through.
  AuthColumn: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

// The wrapper now also reads useTranslation() for i18n.language (issue #435
// milestone, PR5: signUpTo carries the current language cross-origin). Stub
// it rather than pulling in the real i18n singleton — this test isolates
// the wrapper's own logic, same as the two mocks above.
let mockLanguage = 'en';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: mockLanguage } }),
}));

import { render } from '@testing-library/react';
import { LoginPage } from '../LoginPage';

describe('study LoginPage wrapper', () => {
  beforeEach(() => {
    mockLanguage = 'en';
  });

  it('passes Sync/Study branding and a study-role postLoginRouter', () => {
    render(<LoginPage />);

    expect(captured.logoAlt).toBe('Sync/Study');
    const route = captured.postLoginRouter as (r: string | undefined) => string;
    expect(route('tutor')).toBe('/tutor');
    // A study parent lands on the family portal.
    expect(route('parent')).toBe('/family');
    expect(route('admin')).toBe('/admin');
    // Foreign-profile-only / unknown users fall back to /signup, not dead-end '/'.
    expect(route(undefined)).toBe('/signup');
    expect(route('something-else')).toBe('/signup');
  });

  // issue #435 milestone, PR5: study's own role question is retired — the
  // "create an account" link goes straight to sit's cross-origin /enroll,
  // not through study's local /signup redirect hop.
  it('points signUpTo at sit\'s cross-origin /enroll, carrying the current language', () => {
    render(<LoginPage />);
    expect(captured.signUpTo).toBe('https://sync-sit.com/enroll?lang=en');

    mockLanguage = 'fr';
    render(<LoginPage />);
    expect(captured.signUpTo).toBe('https://sync-sit.com/enroll?lang=fr');
  });
});
