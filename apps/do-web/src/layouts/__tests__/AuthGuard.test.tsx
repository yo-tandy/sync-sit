import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

// Controllable authStore state the mock reads from (study-web's AuthGuard
// test pattern, minus the role matrix — the shell guard has no roles yet).
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: null as unknown,
    loading: false,
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    firebaseUser: h.auth.firebaseUser,
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

beforeEach(() => {
  h.auth = { firebaseUser: null, loading: false };
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
    h.auth = { firebaseUser: { uid: 'u1' }, loading: false };
    renderGuard();
    expect(screen.getByText('home-shell')).toBeInTheDocument();
  });
});
