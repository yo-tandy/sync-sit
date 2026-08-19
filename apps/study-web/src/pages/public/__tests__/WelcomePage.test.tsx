import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router';

// The landing now reads useAuthStore to redirect signed-in users; mutable
// mock state keeps the signed-out render pin working unchanged.
const authState: { firebaseUser: unknown; userDoc: unknown; loading: boolean } = {
  firebaseUser: null,
  userDoc: null,
  loading: false,
};
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => authState;
  useAuthStore.getState = () => authState;
  return { useAuthStore };
});

import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { WelcomePage } from '../WelcomePage';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

function renderLanding() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/tutor" element={<div>tutor-portal</div>} />
      <Route path="/family" element={<div>family-portal</div>} />
      <Route path="/welcome-study" element={<div>welcome-study-page</div>} />
    </Routes>,
  );
}

describe('WelcomePage (study)', () => {
  beforeEach(() => {
    authState.firebaseUser = null;
    authState.userDoc = null;
    authState.loading = false;
  });

  it('renders the brand title and the primary CTAs + footer links', () => {
    renderWithProviders(<WelcomePage />);

    expect(screen.getByRole('heading', { name: 'Sync/Study' })).toBeInTheDocument();

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/signup');
    expect(hrefs).toContain('/about');
    expect(hrefs).toContain('/privacy');
    expect(hrefs).toContain('/terms');
    expect(hrefs).toContain('/report');
  });

  // Owner-reported: "/" showed log-in/sign-up to an already-signed-in user.
  it('redirects a signed-in tutor straight to their dashboard', () => {
    authState.firebaseUser = { uid: 't1' };
    authState.userDoc = { profiles: { tutor: { enrollmentComplete: true } } };
    renderLanding();
    expect(screen.getByText('tutor-portal')).toBeInTheDocument();
  });

  it('redirects a signed-in parent straight to the family dashboard', () => {
    authState.firebaseUser = { uid: 'p1' };
    authState.userDoc = { profiles: { parent: { enrollmentComplete: true, familyId: 'f1' } } };
    renderLanding();
    expect(screen.getByText('family-portal')).toBeInTheDocument();
  });

  it('routes a complete cross-app babysitter into the one-tap welcome', () => {
    authState.firebaseUser = { uid: 'b1' };
    authState.userDoc = {
      firstName: 'Noa', lastName: 'Weiss', dateOfBirth: '2008-03-15',
      profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'noa@ejm.org', classLevel: '2nde', contactPhone: '+33 6' } },
    };
    renderLanding();
    expect(screen.getByText('welcome-study-page')).toBeInTheDocument();
  });
});
