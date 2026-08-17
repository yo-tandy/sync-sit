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
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { SignUpRolePage } from '../SignUpRolePage';

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <Routes>
        <Route path="/signup" element={<SignUpRolePage />} />
        <Route path="/welcome-sit" element={<div>welcome-sit landing</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('sit SignUpRolePage wrapper banner', () => {
  beforeEach(() => {
    captured = {};
    authState.firebaseUser = null;
    authState.userDoc = null;
  });

  it('shows the cross-app banner for a signed-in user with no role (and no tutor profile)', () => {
    // A tutor never reaches this page anymore (issue #144, see below); the
    // banner case that remains is a signed-in account with no profiles.
    authState.firebaseUser = { uid: 'u1' };
    authState.userDoc = { profiles: {} };
    renderWithRouter();
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

  // Role exclusivity (issue #116): provider (tutor or babysitter) and parent
  // can never combine, so the impossible option is hidden with a one-line
  // explanation.
  it('a signed-in tutor never sees the role question: redirected to /welcome-sit (issue #144)', () => {
    authState.firebaseUser = { uid: 't1' };
    authState.userDoc = { profiles: { tutor: { enrollmentComplete: true } } };
    renderWithRouter();
    expect(screen.getByText('welcome-sit landing')).toBeInTheDocument();
    // The shared role page never rendered.
    expect(captured.roles).toBeUndefined();
  });

  it('hides the family/parent option with a note for a signed-in babysitter', () => {
    authState.firebaseUser = { uid: 'b1' };
    authState.userDoc = { profiles: { babysitter: { enrollmentComplete: true } } };
    render(<SignUpRolePage />);
    const keys = (captured.roles as Array<{ key: string }>).map((r) => r.key);
    expect(keys).toEqual(['babysitter']);
    expect(captured.note).toBe(i18n.t('signup.roleExclusiveParent'));
  });

  it('hides the babysitter option with a note for a signed-in parent', () => {
    authState.firebaseUser = { uid: 'p1' };
    authState.userDoc = { profiles: { parent: { enrollmentComplete: true, familyId: 'f1' } } };
    render(<SignUpRolePage />);
    const keys = (captured.roles as Array<{ key: string }>).map((r) => r.key);
    expect(keys).toEqual(['parent']);
    expect(captured.note).toBe(i18n.t('signup.roleExclusiveBabysitter'));
  });

  it('offers both options and no note to an unauthenticated visitor', () => {
    render(<SignUpRolePage />);
    const keys = (captured.roles as Array<{ key: string }>).map((r) => r.key);
    expect(keys).toEqual(['babysitter', 'parent']);
    expect(captured.note).toBeUndefined();
  });
});
