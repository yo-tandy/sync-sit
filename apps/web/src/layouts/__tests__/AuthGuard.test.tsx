import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
// The re-consent gate's host (#488) binds `acknowledgeConsent`; the guard
// tests only need it to RENDER, never to call out.
vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => () => new Promise(() => {}) }));
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AuthGuard } from '../AuthGuard';
import { CONSENT_VERSION } from '@ejm/shared-core';

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

  it('admits a half-enrolled babysitter (no incomplete-enrollment redirect anywhere)', () => {
    // Nothing bounces an incomplete babysitter now (#537 D8) — not the hub,
    // and not the babysitter portal either (pinned in its own test below).
    // Completeness is a VISIBILITY question, answered by
    // computeEffectiveSearchable and the dashboard CTA, not an access one.
    state.userDoc = { profiles: { babysitter: { enrollmentComplete: false } } };
    renderRoleless();
    expect(screen.getByText('account hub')).toBeInTheDocument();
    expect(screen.queryByText('enrollment flow')).toBeNull();
  });
});

describe('a skipped offering stage does not cost portal access (#537 D8)', () => {
  /* The offering step is skippable by design: "it just means that the account
     is not active on that sub app". This guard used to eject any babysitter
     with `enrollmentComplete === false` straight back to /enroll/babysitter,
     which made skipping impossible — the step could only escape by writing
     `enrollmentComplete: true`, a claim that was false and that let a later
     flip of the user-controlled `searchable` toggle surface a profile with no
     rate, no kid ages and no area.

     Nothing here asserts the profile stays OUT of search: that is
     computeEffectiveSearchable's job and is pinned where it lives. This pins
     only that the member reaches their portal. */
  function renderBabysitterPortal() {
    render(
      <MemoryRouter initialEntries={['/babysitter']}>
        <Routes>
          <Route
            path="/babysitter"
            element={
              <AuthGuard role="babysitter">
                <div>babysitter portal</div>
              </AuthGuard>
            }
          />
          <Route path="/login" element={<div>login landing</div>} />
          <Route path="/enroll/babysitter" element={<div>enrollment flow</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    state.loading = false;
    state.firebaseUser = { uid: 'u1' };
    state.userDoc = null;
  });
  afterEach(cleanup);

  it('admits a babysitter who skipped the offering stage', () => {
    state.userDoc = {
      consentVersion: CONSENT_VERSION,
      profiles: { babysitter: { enrollmentComplete: false } },
    };
    renderBabysitterPortal();
    expect(screen.getByText('babysitter portal')).toBeInTheDocument();
    expect(screen.queryByText('enrollment flow')).toBeNull();
  });

  it('admits a fully-enrolled babysitter too (the change is not a blanket bypass)', () => {
    state.userDoc = {
      consentVersion: CONSENT_VERSION,
      profiles: { babysitter: { enrollmentComplete: true } },
    };
    renderBabysitterPortal();
    expect(screen.getByText('babysitter portal')).toBeInTheDocument();
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
    state.userDoc = { profiles: { parent: { familyId: 'f1' } }, consentVersion: '0.9' };
    renderGuarded();
    expect(gate()).toBeInTheDocument();
    expect(screen.queryByText('family portal')).toBeNull();
  });

  it('the live version passes straight through', () => {
    state.userDoc = { profiles: { parent: { familyId: 'f1' } }, consentVersion: CONSENT_VERSION };
    renderGuarded();
    expect(gate()).toBeNull();
    expect(screen.getByText('family portal')).toBeInTheDocument();
  });

  it("a pre-unification alias label passes -- it names the same text", () => {
    state.userDoc = { profiles: { parent: { familyId: 'f1' } }, consentVersion: '2026-08-28' };
    renderGuarded();
    expect(gate()).toBeNull();
    expect(screen.getByText('family portal')).toBeInTheDocument();
  });

  it('no consentVersion at all passes -- the account predates the field', () => {
    state.userDoc = { profiles: { parent: { familyId: 'f1' } } };
    renderGuarded();
    expect(gate()).toBeNull();
    expect(screen.getByText('family portal')).toBeInTheDocument();
  });
});
