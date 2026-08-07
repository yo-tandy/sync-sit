import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Hoisted, test-controllable state. The governance dashboard loads everything
// through the getGovernedChildren callable (no client Firestore reads).
const h = vi.hoisted(() => ({
  children: [] as Record<string, unknown>[],
  invites: [] as Record<string, unknown>[],
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));

// The ui barrel pulls the auth store (module-scope onAuthStateChanged) — stub it.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ userDoc: null, firebaseUser: null }),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload?: unknown) => h.callable(name, payload),
}));

import i18n from '@/i18n';
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
      babysitter: { searchable: true, enrollmentComplete: true },
      tutor: null,
    },
    upcoming: { sitAppointments: 2, studySessions: 0 },
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

function renderPage() {
  return render(
    <MemoryRouter>
      <GovernancePage />
    </MemoryRouter>,
  );
}

function reset() {
  i18n.changeLanguage('en');
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

const listCalls = () => h.callable.mock.calls.filter((c) => c[0] === 'getGovernedChildren');

describe('GovernancePage (sit)', () => {
  beforeEach(() => reset());
  afterEach(() => cleanup());

  it('renders a kid row with name, age, profile chip and upcoming counts', async () => {
    h.children = [kid()];
    renderPage();

    expect(await screen.findByText('Noa Weiss')).toBeInTheDocument();
    expect(screen.getByText(/14 years old/i)).toBeInTheDocument();
    expect(screen.getByText(/babysitter/i)).toBeInTheDocument();
    expect(screen.getByText(/next 30 days/i)).toBeInTheDocument();
  });

  it('labels link statuses and links ONLY active kids to the detail page', async () => {
    h.children = [
      kid(),
      kid({ childUid: 'c2', firstName: 'Ben', link: { ...kid().link, status: 'pending' } }),
      kid({ childUid: 'c3', firstName: 'Lea', link: { ...kid().link, status: 'revoked' } }),
    ];
    renderPage();

    expect(await screen.findByText(/awaiting confirmation/i)).toBeInTheDocument();
    expect(screen.getByText(/^active$/i)).toBeInTheDocument();
    expect(screen.getByText(/ended/i)).toBeInTheDocument();

    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/family/governance/c1');
    expect(links).not.toContain('/family/governance/c2');
    expect(links).not.toContain('/family/governance/c3');
  });

  it('marks an invite past its expiresAt as expired', async () => {
    h.invites = [invite({ expiresAt: '2020-01-01T10:00:00.000Z' })];
    renderPage();

    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
  });

  it('resend calls resendKidInvite with the inviteId and refetches (non-optimistic)', async () => {
    h.invites = [invite()];
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /resend/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('resendKidInvite', { inviteId: 'inv1' }),
    );
    await waitFor(() => expect(listCalls()).toHaveLength(2));
  });

  it('cancelling an invite confirms first, calls cancelKidInvite, then refetches', async () => {
    h.invites = [invite()];
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /cancel invitation/i }));
    // Nothing sent before the confirmation.
    expect(h.callable).not.toHaveBeenCalledWith('cancelKidInvite', expect.anything());

    fireEvent.click(await screen.findByRole('button', { name: /yes, cancel invitation/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelKidInvite', { inviteId: 'inv1' }),
    );
    await waitFor(() => expect(listCalls()).toHaveLength(2));
  });

  it('shows an empty state and the add-a-child CTA for a family with nothing yet', async () => {
    renderPage();

    expect(await screen.findByText(/no supervised kids yet/i)).toBeInTheDocument();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/family/governance/new');
  });

  it('shows a load error when the callable rejects', async () => {
    h.callable.mockImplementation(() => Promise.reject(new Error('boom')));
    renderPage();

    expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument();
  });
});
