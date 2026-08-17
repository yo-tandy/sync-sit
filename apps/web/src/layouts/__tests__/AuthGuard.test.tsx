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
