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

// The re-consent gate's host (#488) binds `acknowledgeConsent`; the guard
// tests only need it to RENDER, never to call out.
vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => () => new Promise(() => {}) }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    firebaseUser: h.auth.firebaseUser,
    userDoc: h.auth.userDoc,
    loading: h.auth.loading,
  }),
}));

import { AuthGuard } from '../AuthGuard';
import { CONSENT_VERSION } from '@ejm/shared-core';

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

/**
 * The re-consent gate (issue #488 decision 1). Before role routing: a member
 * whose stored consentVersion is stale sees the gate INSTEAD of any portal;
 * the live version, one of its pre-unification alias labels (study's
 * '2025-12-01', do's '2026-08-28' -- same text, #489), and no field at all
 * (an account older than the field, read as the initial '1.0') all pass.
 */
describe('re-consent gate (#488)', () => {
  // These files render no i18n provider, so the gate's heading carries the
  // raw key; match either that or the English copy.
  const GATE = /We've updated our terms|consentGate\.title/;
  const gate = () => screen.queryByRole('heading', { level: 1, name: GATE });

  it('a stale consentVersion renders the gate and nothing of the app', () => {
    h.auth = { firebaseUser: { uid: 'p0' }, userDoc: { uid: 'p0', profiles: { parent: {} }, consentVersion: '0.9' }, loading: false };
    renderGuard('parent');
    expect(gate()).toBeInTheDocument();
    expect(screen.queryByText('family-portal')).toBeNull();
  });

  it('the live version passes straight through', () => {
    h.auth = { firebaseUser: { uid: 'p0' }, userDoc: { uid: 'p0', profiles: { parent: {} }, consentVersion: CONSENT_VERSION }, loading: false };
    renderGuard('parent');
    expect(gate()).toBeNull();
    expect(screen.getByText('family-portal')).toBeInTheDocument();
  });

  it("a pre-unification alias label passes -- it names the same text", () => {
    h.auth = { firebaseUser: { uid: 'p0' }, userDoc: { uid: 'p0', profiles: { parent: {} }, consentVersion: '2026-08-28' }, loading: false };
    renderGuard('parent');
    expect(gate()).toBeNull();
    expect(screen.getByText('family-portal')).toBeInTheDocument();
  });

  it('no consentVersion at all passes -- the account predates the field', () => {
    h.auth = { firebaseUser: { uid: 'p0' }, userDoc: { uid: 'p0', profiles: { parent: {} } }, loading: false };
    renderGuard('parent');
    expect(gate()).toBeNull();
    expect(screen.getByText('family-portal')).toBeInTheDocument();
  });
});
