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
        <Route path="/welcome-study" element={<div>welcome-study-page</div>} />
        <Route path="/enroll/tutor" element={<div>enroll-tutor-page</div>} />
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

  it('lets a legacy incomplete tutor in — enrollmentComplete false', () => {
    h.auth = {
      firebaseUser: { uid: 't2' },
      userDoc: { uid: 't2', profiles: { tutor: { enrollmentComplete: false } } },
      loading: false,
    };
    renderGuard();
    expect(screen.getByText('tutor-portal')).toBeInTheDocument();
  });

  it('lets a legacy tutor doc with a retired verification field in', () => {
    // Docs written under the dropped identity-verification model may still
    // carry a verification map — the guard must ignore it entirely.
    h.auth = {
      firebaseUser: { uid: 't3' },
      userDoc: {
        uid: 't3',
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

  it('routes a foreign sit babysitter (no study role) to /welcome-study — never the role question (issue #144)', () => {
    h.auth = {
      firebaseUser: { uid: 'b1' },
      userDoc: {
        uid: 'b1', firstName: 'Noa', lastName: 'Weiss', dateOfBirth: '2008-03-15',
        profiles: { babysitter: { ejemEmail: 'noa@ejm.org', classLevel: '2nde', contactPhone: '+33 6' } },
      },
      loading: false,
    };
    renderGuard();
    expect(screen.getByText('welcome-study-page')).toBeInTheDocument();
    expect(screen.queryByText('signup-page')).toBeNull();
    expect(screen.queryByText('tutor-portal')).toBeNull();
  });

  it('routes a babysitter with NO verified EJM identity (no ejemEmail) to the classic wizard instead', () => {
    // Issue #203: gaps like missing contact/DOB/classLevel now stay on the
    // one-tap path (/welcome-study collects them); only a doc the crossApp
    // callable would reject outright (no ejemEmail to derive) falls back.
    h.auth = {
      firebaseUser: { uid: 'b2' },
      userDoc: { uid: 'b2', profiles: { babysitter: {} } },
      loading: false,
    };
    renderGuard();
    expect(screen.getByText('enroll-tutor-page')).toBeInTheDocument();
    expect(screen.queryByText('welcome-study-page')).toBeNull();
  });

  it('a babysitter with gaps but a verified EJM identity stays on /welcome-study (issue #203)', () => {
    h.auth = {
      firebaseUser: { uid: 'b3' },
      // No contact, no DOB, no classLevel — the one-tap page collects these.
      userDoc: { uid: 'b3', firstName: 'Noa', profiles: { babysitter: { ejemEmail: 'noa@ejm.org' } } },
      loading: false,
    };
    renderGuard();
    expect(screen.getByText('welcome-study-page')).toBeInTheDocument();
    expect(screen.queryByText('enroll-tutor-page')).toBeNull();
  });

  it('routes a signed-in account with NO profiles at all to /signup', () => {
    h.auth = {
      firebaseUser: { uid: 'n1' },
      userDoc: { uid: 'n1', profiles: {} },
      loading: false,
    };
    renderGuard();
    expect(screen.getByText('signup-page')).toBeInTheDocument();
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
