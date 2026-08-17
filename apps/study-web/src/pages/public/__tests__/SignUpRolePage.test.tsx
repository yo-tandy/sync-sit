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

import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { SignUpRolePage } from '../SignUpRolePage';

const BANNER = /pick a role to add to your existing account/i;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  authState.firebaseUser = null;
  authState.userDoc = null;
});

describe('SignUpRolePage (study)', () => {
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

  it('shows no banner for a signed-in user who already has a study role', () => {
    authState.firebaseUser = { uid: 'u2' };
    authState.userDoc = { profiles: { tutor: { enrollmentComplete: true } } };
    renderWithProviders(<SignUpRolePage />);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  // Role exclusivity (issue #116): parent and tutor can never combine, so the
  // impossible option is hidden with a one-line explanation.
  it('hides the tutor option with an explanation for a signed-in parent', () => {
    authState.firebaseUser = { uid: 'p1' };
    authState.userDoc = { profiles: { parent: { enrollmentComplete: true, familyId: 'f1' } } };
    renderWithProviders(<SignUpRolePage />);

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/enroll/tutor');
    expect(hrefs).toContain('/enroll/parent');
    expect(screen.getByText(i18n.t('signup.roleExclusiveTutor'))).toBeInTheDocument();
  });

  it('hides the parent option with an explanation for a signed-in tutor', () => {
    authState.firebaseUser = { uid: 't1' };
    authState.userDoc = { profiles: { tutor: { enrollmentComplete: true } } };
    renderWithProviders(<SignUpRolePage />);

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/enroll/parent');
    expect(hrefs).toContain('/enroll/tutor');
    expect(screen.getByText(i18n.t('signup.roleExclusiveParent'))).toBeInTheDocument();
  });

  it('a signed-in sit babysitter never sees the role question: redirected to /welcome-study (issue #144)', () => {
    authState.firebaseUser = { uid: 'b1' };
    authState.userDoc = { profiles: { babysitter: { enrollmentComplete: true } } };
    renderWithProviders(<SignUpRolePage />);

    // The role page never rendered — the wrapper redirected before it.
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('offers both options and no exclusivity note to a signed-in user with no profiles', () => {
    authState.firebaseUser = { uid: 'n1' };
    authState.userDoc = { profiles: {} };
    renderWithProviders(<SignUpRolePage />);

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/enroll/tutor');
    expect(hrefs).toContain('/enroll/parent');
    expect(screen.queryByText(i18n.t('signup.roleExclusiveTutor'))).toBeNull();
    expect(screen.queryByText(i18n.t('signup.roleExclusiveParent'))).toBeNull();
  });
});
