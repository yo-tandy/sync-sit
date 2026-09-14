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
import { SignUpRedirectPage } from '@/pages/public/SignUpRedirectPage';
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
    // issue #435 milestone, PR5: do's own role question is retired — "Sign
    // up" points straight at sit's cross-origin /enroll, not local /signup.
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute(
      'href',
      'https://sync-sit.com/enroll?lang=en',
    );
  });
});

// SignUpRolePage (the doer/parent role picker, banner, and crossApp
// short-circuits) is RETIRED (issue #435 milestone, PR5): /signup now just
// forwards cross-origin to sit's unified /enroll — see
// apps/do-web/src/pages/public/__tests__/SignUpRedirectPage.test.tsx for
// that redirect's own dedicated coverage (target URL, language). This page
// fires a window.location.assign side effect unconditionally and renders no
// role UI, so it needs no auth-state variants here.
describe('SignUpRedirectPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  it('renders no role picker — the retired UI is gone', () => {
    renderWithProviders(<SignUpRedirectPage />);
    expect(screen.queryByRole('link', { name: /doer/i })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
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

  it('shows a support address on a domain that actually receives mail (#349)', () => {
    // NOT support@sync-do.com: sync-do.com is not connected, so this page --
    // live and public on sync-do-app.web.app -- was handing every reader an
    // address that bounces.
    renderWithProviders(<AboutPage />);
    expect(screen.getByRole('link', { name: 'support@sync-sit.com' })).toHaveAttribute(
      'href',
      'mailto:support@sync-sit.com',
    );
    expect(screen.queryByText(/sync-do\.com/)).toBeNull();
  });
});
