import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

// Controllable authStore state the mock reads from (study-web's AuthGuard
// test pattern; the role matrix covers both portals since PR8 made every
// authenticated route role-guarded).
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

/** Both portals plus every destination the guard's mismatch routing can
 * land on. */
function renderGuarded(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/doer"
          element={
            <AuthGuard role="doer">
              <div>doer-portal</div>
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
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.auth = { firebaseUser: null, userDoc: null, loading: false };
});

describe('do-web AuthGuard basics', () => {
  it('redirects a signed-out visitor to /login', () => {
    renderGuarded('/doer');
    expect(screen.getByText('login-page')).toBeInTheDocument();
    expect(screen.queryByText('doer-portal')).toBeNull();
  });

  it('renders nothing while auth state is still loading', () => {
    h.auth = { firebaseUser: null, userDoc: null, loading: true };
    renderGuarded('/doer');
    expect(screen.queryByText('doer-portal')).toBeNull();
    expect(screen.queryByText('login-page')).toBeNull();
  });
});

describe('do-web AuthGuard role="doer" (doer portal, plan §13 PR8)', () => {
  it('renders the portal for an enrolled doer', () => {
    h.auth = {
      firebaseUser: { uid: 'd1' },
      userDoc: { uid: 'd1', profiles: { doer: { enrollmentComplete: true } } },
      loading: false,
    };
    renderGuarded('/doer');
    expect(screen.getByText('doer-portal')).toBeInTheDocument();
  });

  it('lets an ADMIN through (no admin tree in do-web, plan §9.4 — bouncing them off /doer would loop the mismatch fallback)', () => {
    h.auth = {
      firebaseUser: { uid: 'a1' },
      userDoc: { uid: 'a1', isAdmin: true },
      loading: false,
    };
    renderGuarded('/doer');
    expect(screen.getByText('doer-portal')).toBeInTheDocument();
  });

  it('redirects a parent to the family portal', () => {
    h.auth = {
      firebaseUser: { uid: 'p1' },
      userDoc: { uid: 'p1', profiles: { parent: { familyId: 'fam1' } } },
      loading: false,
    };
    renderGuarded('/doer');
    expect(screen.getByText('family-portal')).toBeInTheDocument();
    expect(screen.queryByText('doer-portal')).toBeNull();
  });

  it('sends an account with no sync-do role to /signup to add one', () => {
    h.auth = { firebaseUser: { uid: 'x1' }, userDoc: { uid: 'x1' }, loading: false };
    renderGuarded('/doer');
    expect(screen.getByText('signup-page')).toBeInTheDocument();
  });
});

describe('do-web AuthGuard role="parent" (family portal, plan §13 PR7)', () => {
  it('renders the portal for a parent with a family', () => {
    h.auth = {
      firebaseUser: { uid: 'p1' },
      userDoc: { uid: 'p1', profiles: { parent: { familyId: 'fam1' } } },
      loading: false,
    };
    renderGuarded('/family');
    expect(screen.getByText('family-portal')).toBeInTheDocument();
  });

  it('redirects a doer to the doer portal at /doer', () => {
    h.auth = {
      firebaseUser: { uid: 'd1' },
      userDoc: { uid: 'd1', profiles: { doer: { enrollmentComplete: true } } },
      loading: false,
    };
    renderGuarded('/family');
    expect(screen.getByText('doer-portal')).toBeInTheDocument();
    expect(screen.queryByText('family-portal')).toBeNull();
  });

  it('redirects an admin to /doer, where the doer guard passes them through', () => {
    h.auth = {
      firebaseUser: { uid: 'a1' },
      userDoc: { uid: 'a1', isAdmin: true },
      loading: false,
    };
    renderGuarded('/family');
    expect(screen.getByText('doer-portal')).toBeInTheDocument();
  });

  it('sends an account with no sync-do role to /signup to add one', () => {
    h.auth = { firebaseUser: { uid: 'x1' }, userDoc: { uid: 'x1' }, loading: false };
    renderGuarded('/family');
    expect(screen.getByText('signup-page')).toBeInTheDocument();
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
    h.auth = { firebaseUser: { uid: 'p1' }, userDoc: { uid: 'p1', profiles: { parent: { familyId: 'fam1' } }, consentVersion: '0.9' }, loading: false };
    renderGuarded('/family');
    expect(gate()).toBeInTheDocument();
    expect(screen.queryByText('family-portal')).toBeNull();
  });

  it('the live version passes straight through', () => {
    h.auth = { firebaseUser: { uid: 'p1' }, userDoc: { uid: 'p1', profiles: { parent: { familyId: 'fam1' } }, consentVersion: CONSENT_VERSION }, loading: false };
    renderGuarded('/family');
    expect(gate()).toBeNull();
    expect(screen.getByText('family-portal')).toBeInTheDocument();
  });

  it("a pre-unification alias label passes -- it names the same text", () => {
    h.auth = { firebaseUser: { uid: 'p1' }, userDoc: { uid: 'p1', profiles: { parent: { familyId: 'fam1' } }, consentVersion: '2026-08-28' }, loading: false };
    renderGuarded('/family');
    expect(gate()).toBeNull();
    expect(screen.getByText('family-portal')).toBeInTheDocument();
  });

  it('no consentVersion at all passes -- the account predates the field', () => {
    h.auth = { firebaseUser: { uid: 'p1' }, userDoc: { uid: 'p1', profiles: { parent: { familyId: 'fam1' } } }, loading: false };
    renderGuarded('/family');
    expect(gate()).toBeNull();
    expect(screen.getByText('family-portal')).toBeInTheDocument();
  });
});
