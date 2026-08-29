import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';

// Shell page render smoke tests (study-web's page-test layer, adapted to the
// scaffold): the pages render in brand and wire the shared-ui components
// with do props. Firebase and the auth store are stubbed — rendering is the
// unit under test.
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: null as unknown,
    userDoc: null as unknown,
    loading: false,
    logout: vi.fn(),
  },
}));

vi.mock('@/config/firebase', () => ({ auth: {}, db: {}, functions: {}, storage: {} }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector?: (s: typeof h.auth) => unknown) => (selector ? selector(h.auth) : h.auth),
    { getState: () => h.auth },
  ),
}));

import { renderWithProviders } from '@/__tests__/test-utils';
import { WelcomePage } from '@/pages/public/WelcomePage';
import { SignUpRolePage } from '@/pages/public/SignUpRolePage';
import { ComingSoonPage } from '@/pages/public/ComingSoonPage';
import { AboutPage } from '@/pages/public/AboutPage';

beforeEach(() => {
  h.auth = { firebaseUser: null, userDoc: null, loading: false, logout: vi.fn() };
});

describe('WelcomePage', () => {
  it('renders the do brand title, subtitle and the footer links', () => {
    renderWithProviders(<WelcomePage />);
    expect(screen.getByRole('heading', { name: 'Sync/Do' })).toBeInTheDocument();
    expect(screen.getByText(/student helpers for everyday tasks/i)).toBeInTheDocument();
    for (const [name, href] of [
      ['About', '/about'],
      ['Privacy', '/privacy'],
      ['Terms', '/terms'],
      ['Help', '/report'],
    ] as const) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
  });
});

describe('SignUpRolePage', () => {
  it('offers the doer and parent roles, both leading to the enrollment placeholders', () => {
    renderWithProviders(<SignUpRolePage />);
    expect(screen.getByRole('link', { name: /doer/i })).toHaveAttribute('href', '/enroll/doer');
    expect(screen.getByRole('link', { name: /parent/i })).toHaveAttribute('href', '/enroll/parent');
  });

  it('redirects a signed-in account WITH a sync-do role to its portal', () => {
    h.auth.firebaseUser = { uid: 'u1' };
    h.auth.userDoc = { uid: 'u1', profiles: { doer: { enrollmentComplete: true } } };
    renderWithProviders(<SignUpRolePage />);
    expect(screen.queryByRole('link', { name: /doer/i })).toBeNull();
  });

  it('keeps a signed-in account with NO sync-do role here to add one (PR7 guard fallback)', () => {
    h.auth.firebaseUser = { uid: 'u1' };
    h.auth.userDoc = { uid: 'u1' };
    renderWithProviders(<SignUpRolePage />);
    expect(screen.getByRole('link', { name: /doer/i })).toHaveAttribute('href', '/enroll/doer');
  });
});

describe('ComingSoonPage', () => {
  it('states that sign-up is not open yet and offers the way back', () => {
    renderWithProviders(<ComingSoonPage />);
    expect(screen.getByText(/not open yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });
});

describe('AboutPage', () => {
  it('links OUT to both sibling apps (decision 20 permits this direction)', () => {
    renderWithProviders(<AboutPage />);
    expect(screen.getByRole('link', { name: /sync\/sit/i })).toHaveAttribute(
      'href',
      'https://sync-sit.com',
    );
    expect(screen.getByRole('link', { name: /sync\/study/i })).toHaveAttribute(
      'href',
      'https://sync-study-app.web.app',
    );
  });

  it('shows the do support address', () => {
    renderWithProviders(<AboutPage />);
    expect(screen.getByRole('link', { name: 'support@sync-sit.com' })).toHaveAttribute(
      'href',
      'mailto:support@sync-sit.com',
    );
  });
});
