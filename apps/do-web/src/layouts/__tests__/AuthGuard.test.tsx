import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

// Controllable authStore state the mock reads from (study-web's AuthGuard
// test pattern, including the role matrix since PR7's family portal).
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: null as unknown,
    userDoc: null as unknown,
    loading: false,
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    firebaseUser: h.auth.firebaseUser,
    userDoc: h.auth.userDoc,
    loading: h.auth.loading,
  }),
}));

import { AuthGuard } from '../AuthGuard';

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <Routes>
        <Route
          path="/home"
          element={
            <AuthGuard>
              <div>home-shell</div>
            </AuthGuard>
          }
        />
        <Route path="/login" element={<div>login-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The family portal shape: a role="parent" guarded route plus every
 * destination the guard's mismatch routing can land on. */
function renderParentGuard() {
  return render(
    <MemoryRouter initialEntries={['/family']}>
      <Routes>
        <Route
          path="/family"
          element={
            <AuthGuard role="parent">
              <div>family-portal</div>
            </AuthGuard>
          }
        />
        <Route path="/home" element={<div>home-shell</div>} />
        <Route path="/login" element={<div>login-page</div>} />
        <Route path="/signup" element={<div>signup-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.auth = { firebaseUser: null, userDoc: null, loading: false };
});

describe('do-web AuthGuard', () => {
  it('redirects a signed-out visitor to /login', () => {
    renderGuard();
    expect(screen.getByText('login-page')).toBeInTheDocument();
    expect(screen.queryByText('home-shell')).toBeNull();
  });

  it('renders nothing while auth state is still loading', () => {
    h.auth = { firebaseUser: null, loading: true };
    renderGuard();
    expect(screen.queryByText('home-shell')).toBeNull();
    expect(screen.queryByText('login-page')).toBeNull();
  });

  it('renders the children for any signed-in account (no role gate in the shell)', () => {
    h.auth = { firebaseUser: { uid: 'u1' }, userDoc: null, loading: false };
    renderGuard();
    expect(screen.getByText('home-shell')).toBeInTheDocument();
  });
});

describe('do-web AuthGuard role="parent" (family portal, plan §13 PR7)', () => {
  it('renders the portal for a parent with a family', () => {
    h.auth = {
      firebaseUser: { uid: 'p1' },
      userDoc: { uid: 'p1', profiles: { parent: { familyId: 'fam1' } } },
      loading: false,
    };
    renderParentGuard();
    expect(screen.getByText('family-portal')).toBeInTheDocument();
  });

  it('redirects a doer to the shell home', () => {
    h.auth = {
      firebaseUser: { uid: 'd1' },
      userDoc: { uid: 'd1', profiles: { doer: { enrollmentComplete: true } } },
      loading: false,
    };
    renderParentGuard();
    expect(screen.getByText('home-shell')).toBeInTheDocument();
    expect(screen.queryByText('family-portal')).toBeNull();
  });

  it('redirects an admin to the shell home (no admin tree in do-web, plan §9.4)', () => {
    h.auth = {
      firebaseUser: { uid: 'a1' },
      userDoc: { uid: 'a1', isAdmin: true },
      loading: false,
    };
    renderParentGuard();
    expect(screen.getByText('home-shell')).toBeInTheDocument();
  });

  it('sends an account with no sync-do role to /signup to add one', () => {
    h.auth = { firebaseUser: { uid: 'x1' }, userDoc: { uid: 'x1' }, loading: false };
    renderParentGuard();
    expect(screen.getByText('signup-page')).toBeInTheDocument();
  });

  it('still gates on sign-in and loading like the roleless guard', () => {
    renderParentGuard();
    expect(screen.getByText('login-page')).toBeInTheDocument();
  });
});
