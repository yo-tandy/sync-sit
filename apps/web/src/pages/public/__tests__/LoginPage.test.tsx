import { describe, it, expect, vi } from 'vitest';

// Capture the props the sit LoginPage passes into the shared LoginPage.
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

describe('sit LoginPage wrapper', () => {
  it('passes Sync/Sit branding and a sit-role postLoginRouter', () => {
    render(<LoginPage />);

    expect(captured.logoAlt).toBe('Sync/Sit');
    const route = captured.postLoginRouter as (r: string | undefined) => string;
    expect(route('babysitter')).toBe('/babysitter');
    expect(route('parent')).toBe('/family');
    expect(route('admin')).toBe('/admin');
    // Foreign-profile-only / unknown users fall back to /signup, not dead-end '/'.
    expect(route(undefined)).toBe('/signup');
    expect(route('something-else')).toBe('/signup');
  });
});
