import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The family dashboard reads the auth store
// for the parent profile (greeting + familyId) and loads families/{familyId}
// directly for the verification gate; both are driven through `h`.
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 'p1' } as { uid: string } | null,
    userDoc: null as unknown,
  },
  // What getDoc(families/{id}) resolves to. null => doc absent.
  familyData: null as { familyName?: string; verification?: { isFullyVerified?: boolean } } | null,
  getDoc: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { DashboardPage } from '../DashboardPage';

function parent(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'p1',
    firstName: 'Dana',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1', ...overrides } },
  };
}

function reset() {
  h.auth.firebaseUser = { uid: 'p1' };
  h.auth.userDoc = parent();
  h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: false } };
  h.getDoc.mockImplementation(() =>
    Promise.resolve({ exists: () => h.familyData != null, data: () => h.familyData }),
  );
}

describe('family DashboardPage', () => {
  beforeEach(() => reset());

  it('greets the parent by first name', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText(/Dana/)).toBeInTheDocument();
  });

  it('shows the verification banner when the family is not fully verified', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: false } };
    renderWithProviders(<DashboardPage />);
    // Banner explains verification happens in the sit app and search is locked.
    expect(await screen.findByText(/verify your family/i)).toBeInTheDocument();
    // No active search CTA while unverified.
    expect(screen.queryByRole('link', { name: /find a tutor/i })).not.toBeInTheDocument();
  });

  it('treats an absent verification field as not verified (banner shown)', async () => {
    h.familyData = { familyName: 'Cohen' }; // no verification => not verified
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/verify your family/i)).toBeInTheDocument();
  });

  it('shows the find-a-tutor CTA (and hides the banner) when fully verified', async () => {
    h.familyData = { familyName: 'Cohen', verification: { isFullyVerified: true } };
    renderWithProviders(<DashboardPage />);
    const cta = await screen.findByRole('link', { name: /find a tutor/i });
    expect(cta).toHaveAttribute('href', '/family/search');
    expect(screen.queryByText(/verify your family/i)).not.toBeInTheDocument();
  });

  it('renders the requests placeholder card', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText(/no requests yet/i)).toBeInTheDocument();
  });

  it('renders entry cards linking to settings and account', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('link', { name: /family settings/i })).toHaveAttribute(
      'href',
      '/family/settings',
    );
    expect(screen.getByRole('link', { name: /account/i })).toHaveAttribute(
      'href',
      '/family/account',
    );
  });
});
