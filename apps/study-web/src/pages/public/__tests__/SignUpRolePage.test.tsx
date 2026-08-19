import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';

// The wrapper now reads useAuthStore() to decide whether to show the cross-app
// banner. Mock it (mutable state; defaults to unauthenticated) so the existing
// render tests don't pull in the real firebase-backed store.
const authState: { firebaseUser: unknown; userDoc: unknown } = {
  firebaseUser: null,
  userDoc: null,
};
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => authState;
  useAuthStore.getState = () => authState;
  return { useAuthStore };
});

import { Routes, Route } from 'react-router';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { SignUpRolePage } from '../SignUpRolePage';

// For redirect pins: Navigate needs a route table to land on.
function renderWithPortals() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<SignUpRolePage />} />
      <Route path="/tutor" element={<div>tutor-portal</div>} />
      <Route path="/family" element={<div>family-portal</div>} />
    </Routes>,
  );
}

const BANNER = /pick a role to add to your existing account/i;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  authState.firebaseUser = null;
  authState.userDoc = null;
});

describe('SignUpRolePage (study)', () => {
  it('a signed-in tutor on /signup goes straight to their portal (no dead option loop)', () => {
    authState.firebaseUser = { uid: 't1' };
    authState.userDoc = { profiles: { tutor: { enrollmentComplete: true } } };
    renderWithPortals();
    expect(screen.getByText('tutor-portal')).toBeInTheDocument();
    expect(screen.queryByText(/sign up as/i)).toBeNull();
  });

  it('offers Tutor and Parent (not Babysitter) with the right enroll links', () => {
    renderWithProviders(<SignUpRolePage />);

    const hrefs = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/enroll/tutor');
    expect(hrefs).toContain('/enroll/parent');

    // The tutor role card label, and no babysitter anywhere.
    expect(screen.getByText('Tutor')).toBeInTheDocument();
    expect(screen.queryByText(/Babysitter/i)).toBeNull();
  });

  it('shows the cross-app banner for a signed-in user with no role (and no babysitter profile)', () => {
    // A sit babysitter never reaches this page anymore (issue #144, see
    // below); the banner case that remains is a signed-in account with no
    // profiles.
    authState.firebaseUser = { uid: 'u1' };
    authState.userDoc = { profiles: {} };
    renderWithProviders(<SignUpRolePage />);
    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it('shows no banner for an unauthenticated visitor', () => {
    renderWithProviders(<SignUpRolePage />);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  // Role'd users never see this page anymore (the dead-option loop fix), so
  // the old signed-in banner/exclusivity render pins became redirect pins.
  // The client-side exclusivity withholding was removed as unreachable
  // (issue #159); the server guard (addProfileToUser) is the real defense.
  it('a signed-in parent on /signup goes straight to the family portal', () => {
    authState.firebaseUser = { uid: 'p1' };
    authState.userDoc = { profiles: { parent: { enrollmentComplete: true, familyId: 'f1' } } };
    renderWithPortals();
    expect(screen.getByText('family-portal')).toBeInTheDocument();
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('a signed-in sit babysitter never sees the role question: redirected to /welcome-study (issue #144)', () => {
    authState.firebaseUser = { uid: 'b1' };
    authState.userDoc = { profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'b1@ejm.org' } } };
    renderWithProviders(<SignUpRolePage />);

    // The role page never rendered — the wrapper redirected before it.
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('offers the full unfiltered option list to a signed-in user with no profiles', () => {
    authState.firebaseUser = { uid: 'n1' };
    authState.userDoc = { profiles: {} };
    renderWithProviders(<SignUpRolePage />);

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/enroll/tutor');
    expect(hrefs).toContain('/enroll/parent');
  });
});
