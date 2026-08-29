import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the authStore with mutable state: the guard's foreign-profile fallback
// forks on WHICH foreign profile the signed-in user carries (issue #144).
const state: {
  firebaseUser: unknown;
  userDoc: Record<string, unknown> | null;
  loading: boolean;
} = {
  firebaseUser: { uid: 'u1' },
  userDoc: null,
  loading: false,
};
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AuthGuard } from '../AuthGuard';

/**
 * The ROLE-LESS branch (#367 hub, #416 review). `AuthGuard.role` became
 * optional so the shared account hub can be reached by a parent and a student
 * alike, and that new branch shipped with no test in the file that exists
 * specifically to pin this guard's branching.
 */
function renderRoleless(entry = '/account') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/account"
          element={
            <AuthGuard>
              <div>account hub</div>
            </AuthGuard>
          }
        />
        <Route path="/login" element={<div>login landing</div>} />
        <Route path="/enroll/babysitter" element={<div>enrollment flow</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderGuarded() {
  render(
    <MemoryRouter initialEntries={['/family']}>
      <Routes>
        <Route
          path="/family"
          element={
            <AuthGuard role="parent">
              <div>family portal</div>
            </AuthGuard>
          }
        />
        <Route path="/signup" element={<div>signup landing</div>} />
        <Route path="/welcome-sit" element={<div>welcome-sit landing</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  state.firebaseUser = { uid: 'u1' };
  state.userDoc = null;
  state.loading = false;
});

describe('AuthGuard foreign-profile fallback', () => {
  it('routes a signed-in study tutor (no sit role) to /welcome-sit — never the role question (issue #144)', () => {
    state.userDoc = { profiles: { tutor: { enrollmentComplete: true } } };
    renderGuarded();

    expect(screen.getByText('welcome-sit landing')).toBeInTheDocument();
    expect(screen.queryByText('signup landing')).toBeNull();
    expect(screen.queryByText('family portal')).toBeNull();
  });

  it('redirects a signed-in user with NO profiles at all to /signup', () => {
    state.userDoc = { profiles: {} };
    renderGuarded();

    expect(screen.getByText('signup landing')).toBeInTheDocument();
    expect(screen.queryByText('family portal')).toBeNull();
  });
});

describe('AuthGuard with no role (the shared hub)', () => {
  it('admits a parent', () => {
    state.userDoc = { profiles: { parent: { familyId: 'f1' } } };
    renderRoleless();
    expect(screen.getByText('account hub')).toBeInTheDocument();
  });

  it('admits a student — the same hub, whatever the portal', () => {
    state.userDoc = { profiles: { babysitter: { enrollmentComplete: true } } };
    renderRoleless();
    expect(screen.getByText('account hub')).toBeInTheDocument();
  });

  it('admits a signed-in member with NO sit role at all', () => {
    // Role-less means signed-in is the whole requirement: a study-only tutor
    // still owns the shared account, so bouncing them here would be wrong.
    state.userDoc = { profiles: { tutor: { enrollmentComplete: true } } };
    renderRoleless();
    expect(screen.getByText('account hub')).toBeInTheDocument();
  });

  it('still requires SIGN-IN — role-less is not guard-less', () => {
    state.firebaseUser = null;
    state.userDoc = null;
    renderRoleless();
    expect(screen.getByText('login landing')).toBeInTheDocument();
    expect(screen.queryByText('account hub')).toBeNull();
  });

  it('deliberately SKIPS the incomplete-enrollment redirect', () => {
    // A half-enrolled babysitter is bounced to /enroll/babysitter inside the
    // babysitter portal. The hub is not the babysitter portal, and the shared
    // account is exactly what such a member may still need to reach.
    state.userDoc = { profiles: { babysitter: { enrollmentComplete: false } } };
    renderRoleless();
    expect(screen.getByText('account hub')).toBeInTheDocument();
    expect(screen.queryByText('enrollment flow')).toBeNull();
  });
});
