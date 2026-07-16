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
  // studyContactRequests docs for the pending/accepted counts.
  requests: [] as Record<string, unknown>[],
  getDoc: vi.fn(),
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  getDocs: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
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
  h.requests = [];
  h.where.mockClear();
  h.getDocs.mockReset();
  h.getDocs.mockImplementation(() =>
    Promise.resolve({ docs: h.requests.map((r) => ({ id: r.requestId, data: () => r })) }),
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

  it('renders live pending/accepted request counts linking to the requests page', async () => {
    h.requests = [
      { requestId: 'r1', familyId: 'fam1', status: 'pending' },
      { requestId: 'r2', familyId: 'fam1', status: 'pending' },
      { requestId: 'r3', familyId: 'fam1', status: 'accepted' },
      { requestId: 'r4', familyId: 'fam1', status: 'declined' },
    ];
    renderWithProviders(<DashboardPage />);

    const link = await screen.findByRole('link', { name: /requests/i });
    expect(link).toHaveAttribute('href', '/family/requests');
    expect(h.where).toHaveBeenCalledWith('familyId', '==', 'fam1');
    // 2 pending, 1 accepted.
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows the empty requests message when the family has none', async () => {
    h.requests = [];
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
  });

  it('does not flash the no-requests message while counts are still loading', () => {
    // getDocs never resolves → counts stay null → no empty message yet.
    h.getDocs.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<DashboardPage />);
    expect(screen.queryByText(/no requests yet/i)).not.toBeInTheDocument();
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
