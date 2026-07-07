import { describe, it, expect, vi } from 'vitest';

// Mock the authStore: a signed-in user whose only profile is foreign to
// sync-sit (a study tutor). getSitRole() therefore returns undefined, so the
// guard must fall through to its final /signup fallback rather than dead-end.
vi.mock('@/stores/authStore', () => {
  const state = {
    firebaseUser: { uid: 'u1' },
    userDoc: { profiles: { tutor: { enrollmentComplete: true } } },
    loading: false,
  };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AuthGuard } from '../AuthGuard';

describe('AuthGuard foreign-profile fallback', () => {
  it('redirects a signed-in foreign-profile-only user to /signup', () => {
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
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('signup landing')).toBeInTheDocument();
    expect(screen.queryByText('family portal')).not.toBeInTheDocument();
  });
});
