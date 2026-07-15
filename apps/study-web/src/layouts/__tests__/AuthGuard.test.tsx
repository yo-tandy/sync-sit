import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

// Controllable authStore state the mock reads from. getStudyRole runs for real
// against these userDoc shapes (profiles.tutor => tutor, profiles.parent =>
// parent, isAdmin => admin), so the guard's routing is exercised end to end.
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

type GuardRole = 'tutor' | 'parent';

function renderGuard(
  role: GuardRole = 'tutor',
  initialPath: string = role === 'parent' ? '/family' : '/tutor',
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/tutor"
          element={
            <AuthGuard role="tutor">
              <div>tutor-portal</div>
            </AuthGuard>
          }
        />
        <Route
          path="/family"
          element={
            <AuthGuard role="parent">
              <div>family-portal</div>
            </AuthGuard>
          }
        />
        <Route path="/login" element={<div>login-page</div>} />
        <Route path="/signup" element={<div>signup-page</div>} />
        <Route path="/admin" element={<div>admin-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.auth = { firebaseUser: null, userDoc: null, loading: false };
});

describe('study-web AuthGuard', () => {
  it('redirects a signed-out visitor to /login', () => {
    h.auth = { firebaseUser: null, userDoc: null, loading: false };
    renderGuard();
    expect(screen.getByText('login-page')).toBeInTheDocument();
    expect(screen.queryByText('tutor-portal')).toBeNull();
  });

  it('renders nothing while auth state is still loading', () => {
    h.auth = { firebaseUser: null, userDoc: null, loading: true };
    renderGuard();
    expect(screen.queryByText('tutor-portal')).toBeNull();
    expect(screen.queryByText('login-page')).toBeNull();
    expect(screen.queryByText('signup-page')).toBeNull();
  });

  it('lets an APPROVED tutor into the portal', () => {
    h.auth = {
      firebaseUser: { uid: 't1' },
      userDoc: { uid: 't1', profiles: { tutor: { enrollmentComplete: true } } },
      loading: false,
    };
    renderGuard();
    expect(screen.getByText('tutor-portal')).toBeInTheDocument();
  });

  it('lets an UNAPPROVED tutor in — enrollmentComplete false, no verification (pre-#77)', () => {
    h.auth = {
      firebaseUser: { uid: 't2' },
      userDoc: { uid: 't2', profiles: { tutor: { enrollmentComplete: false } } },
      loading: false,
    };
    renderGuard();
    expect(screen.getByText('tutor-portal')).toBeInTheDocument();
  });

  it('lets a tutor with a PENDING identity submission in', () => {
    h.auth = {
      firebaseUser: { uid: 't3' },
      userDoc: {
        uid: 't3',
        profiles: {
          tutor: {
            enrollmentComplete: false,
            verification: { identityStatus: 'pending' },
          },
        },
      },
      loading: false,
    };
    renderGuard();
    expect(screen.getByText('tutor-portal')).toBeInTheDocument();
  });

  it('lets a tutor with a REJECTED identity submission in', () => {
    h.auth = {
      firebaseUser: { uid: 't4' },
      userDoc: {
        uid: 't4',
        profiles: {
          tutor: {
            enrollmentComplete: false,
            verification: { identityStatus: 'rejected' },
          },
        },
      },
      loading: false,
    };
    renderGuard();
    expect(screen.getByText('tutor-portal')).toBeInTheDocument();
  });

  it('lets a study parent into the family portal', () => {
    h.auth = {
      firebaseUser: { uid: 'p0' },
      userDoc: { uid: 'p0', profiles: { parent: {} } },
      loading: false,
    };
    renderGuard('parent');
    expect(screen.getByText('family-portal')).toBeInTheDocument();
  });

  it('routes a study parent hitting the tutor guard to /family', () => {
    h.auth = {
      firebaseUser: { uid: 'p1' },
      userDoc: { uid: 'p1', profiles: { parent: {} } },
      loading: false,
    };
    renderGuard('tutor');
    expect(screen.getByText('family-portal')).toBeInTheDocument();
    expect(screen.queryByText('tutor-portal')).toBeNull();
  });

  it('routes a tutor hitting the parent guard to /tutor', () => {
    h.auth = {
      firebaseUser: { uid: 't5' },
      userDoc: { uid: 't5', profiles: { tutor: { enrollmentComplete: true } } },
      loading: false,
    };
    renderGuard('parent');
    expect(screen.getByText('tutor-portal')).toBeInTheDocument();
    expect(screen.queryByText('family-portal')).toBeNull();
  });

  it('routes a foreign sit-only account (no study role) away to /signup', () => {
    h.auth = {
      firebaseUser: { uid: 'b1' },
      userDoc: { uid: 'b1', profiles: { babysitter: {} } },
      loading: false,
    };
    renderGuard();
    expect(screen.getByText('signup-page')).toBeInTheDocument();
    expect(screen.queryByText('tutor-portal')).toBeNull();
  });

  it('routes an admin to /admin (mirrors LoginPage.postLoginRouter)', () => {
    h.auth = {
      firebaseUser: { uid: 'a1' },
      userDoc: { uid: 'a1', isAdmin: true, profiles: {} },
      loading: false,
    };
    renderGuard();
    expect(screen.getByText('admin-page')).toBeInTheDocument();
    expect(screen.queryByText('tutor-portal')).toBeNull();
  });
});
