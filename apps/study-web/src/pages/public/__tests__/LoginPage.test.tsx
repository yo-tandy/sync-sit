import { describe, it, expect, vi } from 'vitest';

// Capture the props the study LoginPage passes into the shared LoginPage.
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

import { render } from '@testing-library/react';
import { LoginPage } from '../LoginPage';

describe('study LoginPage wrapper', () => {
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
});
