import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The governance dashboard loads everything
// through the getGovernedChildren callable (no client Firestore reads).
const h = vi.hoisted(() => ({
  children: [] as Record<string, unknown>[],
  invites: [] as Record<string, unknown>[],
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ functions: {} }));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload?: unknown) => h.callable(name, payload),
}));

import { GovernancePage } from '../GovernancePage';

function kid(overrides: Record<string, unknown> = {}) {
  return {
    childUid: 'c1',
    firstName: 'Noa',
    lastName: 'Weiss',
    photoUrl: null,
    status: 'active',
    age: 14,
    link: {
      status: 'active',
      origin: 'parent_created',
      requestedAt: '2026-07-01T10:00:00.000Z',
      confirmedAt: '2026-07-02T10:00:00.000Z',
      revokedAt: null,
    },
    profiles: {
      babysitter: null,
      tutor: { searchable: true, enrollmentComplete: true },
    },
    upcoming: { sitAppointments: 0, studySessions: 2 },
    ...overrides,
  };
}

function invite(overrides: Record<string, unknown> = {}) {
  return {
    inviteId: 'inv1',
    kidEmail: 'noa28@ejm.org',
    firstName: 'Noa',
    lastName: 'Weiss',
    status: 'pending',
    createdAt: '2026-08-01T10:00:00.000Z',
    expiresAt: '2099-01-01T10:00:00.000Z',
    resentAt: null,
    ...overrides,
  };
}

function reset() {
  h.children = [];
  h.invites = [];
  h.callable.mockReset();
  h.callable.mockImplementation((name: string) => {
    if (name === 'getGovernedChildren') {
      return Promise.resolve({ data: { children: h.children, invites: h.invites } });
    }
    return Promise.resolve({ data: { success: true } });
  });
}

describe('GovernancePage', () => {
  beforeEach(() => reset());

  it('does not flash the empty state while the callable is in flight', () => {
    h.callable.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<GovernancePage />);
    expect(screen.queryByText(/no supervised kids yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });

  it('shows a load error when the callable rejects', async () => {
    h.callable.mockImplementation(() => Promise.reject(new Error('boom')));
    renderWithProviders(<GovernancePage />);
    expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument();
  });

  it('renders a kid row with name, age, profile chip and upcoming counts', async () => {
    h.children = [kid()];
    renderWithProviders(<GovernancePage />);

    expect(await screen.findByText(/Noa Weiss/)).toBeInTheDocument();
    expect(screen.getByText(/14/)).toBeInTheDocument();
    // Tutor profile chip with its searchable state.
    expect(screen.getByText(/tutor ·/i)).toBeInTheDocument();
    expect(screen.getByText(/visible in search/i)).toBeInTheDocument();
    // Upcoming 30-day counts.
    expect(screen.getByText(/2 tutoring/i)).toBeInTheDocument();
  });

  it('labels link statuses: pending → awaiting confirmation, active, revoked → ended', async () => {
    h.children = [
      kid({ childUid: 'c1', firstName: 'Ava', link: { ...kid().link, status: 'pending', origin: 'claim' } }),
      kid({ childUid: 'c2', firstName: 'Ben', link: { ...kid().link, status: 'active' } }),
      kid({ childUid: 'c3', firstName: 'Gil', link: { ...kid().link, status: 'revoked' } }),
    ];
    renderWithProviders(<GovernancePage />);

    expect(await screen.findByText(/awaiting confirmation/i)).toBeInTheDocument();
    expect(screen.getByText(/^active$/i)).toBeInTheDocument();
    expect(screen.getByText(/ended/i)).toBeInTheDocument();
  });

  it('links ONLY active kids to their oversight detail page', async () => {
    h.children = [
      kid({ childUid: 'c1', firstName: 'Ava', link: { ...kid().link, status: 'active' } }),
      kid({ childUid: 'c2', firstName: 'Ben', link: { ...kid().link, status: 'pending' } }),
    ];
    renderWithProviders(<GovernancePage />);

    const link = await screen.findByRole('link', { name: /Ava/ });
    expect(link).toHaveAttribute('href', '/family/governance/c1');
    expect(screen.queryByRole('link', { name: /Ben/ })).not.toBeInTheDocument();
  });

  it('renders pending invitations with kid identity and expiry date', async () => {
    h.invites = [invite()];
    renderWithProviders(<GovernancePage />);

    expect(await screen.findByText(/noa28@ejm.org/)).toBeInTheDocument();
    expect(screen.getByText(/expires/i)).toBeInTheDocument();
    expect(screen.queryByText(/expired\b/i)).not.toBeInTheDocument();
  });

  it('marks an invite past its expiresAt as expired', async () => {
    h.invites = [invite({ expiresAt: '2020-01-01T10:00:00.000Z' })];
    renderWithProviders(<GovernancePage />);
    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
  });

  it('resend calls resendKidInvite with the inviteId and refetches (non-optimistic)', async () => {
    h.invites = [invite()];
    renderWithProviders(<GovernancePage />);

    fireEvent.click(await screen.findByRole('button', { name: /resend/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('resendKidInvite', { inviteId: 'inv1' }),
    );
    // Initial load + post-resend refetch.
    await waitFor(() =>
      expect(
        h.callable.mock.calls.filter((c) => c[0] === 'getGovernedChildren'),
      ).toHaveLength(2),
    );
  });

  it('cancelling an invite confirms first, calls cancelKidInvite, then refetches', async () => {
    h.invites = [invite()];
    renderWithProviders(<GovernancePage />);

    fireEvent.click(await screen.findByRole('button', { name: /cancel invitation/i }));
    // Nothing sent until the dialog is confirmed.
    expect(h.callable).not.toHaveBeenCalledWith('cancelKidInvite', expect.anything());

    fireEvent.click(await screen.findByRole('button', { name: /yes, cancel/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelKidInvite', { inviteId: 'inv1' }),
    );
    await waitFor(() =>
      expect(
        h.callable.mock.calls.filter((c) => c[0] === 'getGovernedChildren'),
      ).toHaveLength(2),
    );
  });

  it('dismissing the cancel dialog sends nothing', async () => {
    h.invites = [invite()];
    renderWithProviders(<GovernancePage />);

    fireEvent.click(await screen.findByRole('button', { name: /cancel invitation/i }));
    fireEvent.click(await screen.findByRole('button', { name: /keep invitation/i }));

    expect(h.callable).not.toHaveBeenCalledWith('cancelKidInvite', expect.anything());
  });

  it('shows an empty state and the add-a-child CTA for a family with nothing yet', async () => {
    renderWithProviders(<GovernancePage />);

    expect(await screen.findByText(/no supervised kids yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add a child/i })).toHaveAttribute(
      'href',
      '/family/governance/new',
    );
  });
});
