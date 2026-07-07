import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the props the sit SignUpRolePage wrapper passes into the shared one.
let captured: Record<string, unknown> = {};
vi.mock('@ejm/shared-ui', () => ({
  SignUpRolePage: (props: Record<string, unknown>) => {
    captured = props;
    return null;
  },
  UserIcon: () => null,
  UsersIcon: () => null,
}));

// Mutable auth state the wrapper reads via useAuthStore().
const authState: { firebaseUser: unknown; userDoc: unknown } = {
  firebaseUser: null,
  userDoc: null,
};
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => authState;
  useAuthStore.getState = () => authState;
  return { useAuthStore };
});

import i18n from '@/i18n';
import { render } from '@testing-library/react';
import { SignUpRolePage } from '../SignUpRolePage';

describe('sit SignUpRolePage wrapper banner', () => {
  beforeEach(() => {
    captured = {};
    authState.firebaseUser = null;
    authState.userDoc = null;
  });

  it('shows the cross-app banner for a signed-in foreign-profile-only user', () => {
    authState.firebaseUser = { uid: 'u1' };
    authState.userDoc = { profiles: { tutor: { enrollmentComplete: true } } };
    render(<SignUpRolePage />);
    expect(captured.banner).toBe(i18n.t('signup.crossAppBanner'));
  });

  it('shows no banner for an unauthenticated visitor', () => {
    render(<SignUpRolePage />);
    expect(captured.banner).toBeUndefined();
  });

  it('shows no banner for a signed-in user who already has a sit role', () => {
    authState.firebaseUser = { uid: 'u2' };
    authState.userDoc = { profiles: { babysitter: { enrollmentComplete: true } } };
    render(<SignUpRolePage />);
    expect(captured.banner).toBeUndefined();
  });
});
