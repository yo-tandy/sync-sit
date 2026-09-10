import { describe, it, expect, vi } from 'vitest';

// Capture the props the sit WelcomePage wrapper passes into the shared one.
let captured: Record<string, unknown> = {};
vi.mock('@ejm/shared-ui', () => ({
  WelcomePage: (props: Record<string, unknown>) => {
    captured = props;
    return null;
  },
}));

vi.mock('@/stores/authStore', () => {
  const state = { firebaseUser: null, userDoc: null, loading: false };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { render } from '@testing-library/react';
import { WelcomePage } from '../WelcomePage';

// issue #435 milestone, PR5: /signup is retired — the landing page's
// "Sign up" CTA goes straight to /enroll, the unified landing page, instead
// of taking the extra /signup -> /enroll redirect hop.
describe('sit WelcomePage wrapper', () => {
  it('points the "Sign up" CTA at /enroll, not /signup', () => {
    render(<WelcomePage />);
    expect(captured.signUpTo).toBe('/enroll');
  });

  it('still passes Sync/Sit branding', () => {
    render(<WelcomePage />);
    expect(captured.logoAlt).toBe('Sync/Sit');
  });
});
