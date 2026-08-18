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
        <Route path="/babysitter" element={<div>babysitter-portal</div>} />
        <Route path="/family" element={<div>family-portal</div>} />
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

  it('a signed-in babysitter on /signup goes straight to their portal (no dead option loop)', () => {
    authState.firebaseUser = { uid: 'b1' };
    authState.userDoc = { profiles: { babysitter: { enrollmentComplete: true } } };
    renderWithRouter();
    expect(screen.getByText('babysitter-portal')).toBeInTheDocument();
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

  // Role'd users never see this page anymore (dead-option-loop fix): the old
  // banner/exclusivity render pins became redirect pins. The client-side
  // exclusivity withholding was removed as unreachable (issue #159); the
  // server guard (addProfileToUser) is the real defense.
  it('a signed-in tutor never sees the role question: redirected to /welcome-sit (issue #144)', () => {
    authState.firebaseUser = { uid: 't1' };
    authState.userDoc = { profiles: { tutor: { enrollmentComplete: true } } };
    renderWithRouter();
    expect(screen.getByText('welcome-sit landing')).toBeInTheDocument();
    // The shared role page never rendered.
    expect(captured.roles).toBeUndefined();
  });

  it('a signed-in parent on /signup goes straight to the family portal', () => {
    authState.firebaseUser = { uid: 'p1' };
    authState.userDoc = { profiles: { parent: { enrollmentComplete: true, familyId: 'f1' } } };
    renderWithRouter();
    expect(screen.getByText('family-portal')).toBeInTheDocument();
  });

  it('offers the full unfiltered option list to an unauthenticated visitor', () => {
    render(<SignUpRolePage />);
    const keys = (captured.roles as Array<{ key: string }>).map((r) => r.key);
    expect(keys).toEqual(['babysitter', 'parent']);
  });
});
