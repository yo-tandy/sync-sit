import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Recording httpsCallable mock: the REAL adminStore runs against it, so these
// tests pin the exact callable names + payloads the panel sends.
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  accounts: [] as Record<string, unknown>[],
  alerts: [] as Record<string, unknown>[],
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));

// The ui barrel pulls the auth store (module-scope onAuthStateChanged) — stub it.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ userDoc: null, firebaseUser: null }),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    switch (name) {
      case 'listSupervisedAccounts':
        return Promise.resolve({ data: { accounts: [...h.accounts] } });
      case 'listAdminAlerts':
        return Promise.resolve({ data: { alerts: [...h.alerts] } });
      default:
        return Promise.resolve({ data: { success: true } });
    }
  },
}));

import i18n from '@/i18n';
import { AdminGovernancePage } from '../GovernancePage';

function account(overrides: Record<string, unknown> = {}) {
  return {
    childUid: 'c1',
    child: {
      firstName: 'Noa',
      lastName: 'Weiss',
      email: 'noa28@ejm.org',
      status: 'active',
      age: 13,
      identityLocked: true,
    },
    familyId: 'fam1',
    familyName: 'Dupont',
    link: {
      status: 'active',
      origin: 'parent_created',
      createdByParentUid: 'p1',
      requestedAt: '2026-07-01T10:00:00.000Z',
      confirmedAt: '2026-07-02T10:00:00.000Z',
      revokedAt: null,
      revokedByUid: null,
    },
    consent: {
      tosVersion: '1.0',
      privacyVersion: '1.0',
      supervisionAgreementVersion: '1.0',
      approvedAt: '2026-07-01T10:00:00.000Z',
      approvedByUid: 'p1',
    },
    ...overrides,
  };
}

function alert(overrides: Record<string, unknown> = {}) {
  return {
    alertId: 'al1',
    type: 'guardian_conflicting_claim',
    data: { kidEmailLower: 'noa28@ejm.org', familyId: 'fam2' },
    createdAt: '2026-08-01T10:00:00.000Z',
    reviewedAt: null,
    reviewedByUid: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminGovernancePage />
    </MemoryRouter>,
  );
}

const calls = (name: string) => h.calls.filter((c) => c.name === name);

beforeEach(() => {
  i18n.changeLanguage('en');
  h.calls.length = 0;
  h.accounts = [account()];
  h.alerts = [alert()];
});
afterEach(() => cleanup());

describe('AdminGovernancePage', () => {
  it('lists supervised accounts with the GDPR consent record (versions + date)', async () => {
    renderPage();

    expect(await screen.findByText('Noa Weiss')).toBeInTheDocument();
    expect(screen.getByText('Dupont')).toBeInTheDocument();
    expect(screen.getByText(/parent-created/i)).toBeInTheDocument();
    // The consent columns: all three versions and the approval date.
    expect(screen.getByText(/ToS 1\.0 · Privacy 1\.0 · Agreement 1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Jul 1, 2026/)).toBeInTheDocument();
    expect(calls('listSupervisedAccounts')).toHaveLength(1);
  });

  it('fetches alerts unreviewed-only by default and refetches with the toggle', async () => {
    renderPage();

    await waitFor(() => expect(calls('listAdminAlerts')).toHaveLength(1));
    expect(calls('listAdminAlerts')[0].payload).toEqual({ onlyUnreviewed: true });
    expect(await screen.findByText(/conflicting supervision claim/i)).toBeInTheDocument();
    // The payload summary shows what the alert is about.
    expect(screen.getByText(/kidEmailLower: noa28@ejm.org/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/only unreviewed/i));
    await waitFor(() => expect(calls('listAdminAlerts')).toHaveLength(2));
    expect(calls('listAdminAlerts')[1].payload).toEqual({ onlyUnreviewed: false });
  });

  it('mark reviewed pins reviewAdminAlert and refetches (non-optimistic)', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /mark reviewed/i }));

    await waitFor(() => expect(calls('reviewAdminAlert')).toHaveLength(1));
    expect(calls('reviewAdminAlert')[0].payload).toEqual({ alertId: 'al1' });
    await waitFor(() => expect(calls('listAdminAlerts')).toHaveLength(2));
  });

  it('force-revoking an under-15 kid warns the account will be blocked, requires a reason', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /force revoke/i }));

    // Under-15 pairing warning (mirrors the backend: minor → blocked + disabled).
    expect(await screen.findByText(/account will be blocked/i)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /yes, revoke/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/reason/i), {
      target: { value: 'Custody order' },
    });
    fireEvent.click(screen.getByRole('button', { name: /yes, revoke/i }));

    await waitFor(() => expect(calls('forceRevokeSupervision')).toHaveLength(1));
    expect(calls('forceRevokeSupervision')[0].payload).toEqual({
      childUid: 'c1',
      reason: 'Custody order',
    });
    // Non-optimistic: the accounts list is refetched after the callable.
    await waitFor(() => expect(calls('listSupervisedAccounts')).toHaveLength(2));
  });

  it('shows no blocked-account warning for a 15+ kid', async () => {
    h.accounts = [account({ child: { ...account().child, age: 16 } })];
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /force revoke/i }));

    expect(screen.queryByText(/account will be blocked/i)).not.toBeInTheDocument();
  });

  it('offers force revoke only on active links', async () => {
    h.accounts = [account({ link: { ...account().link, status: 'revoked' } })];
    renderPage();

    await screen.findByText('Noa Weiss');
    expect(screen.queryByRole('button', { name: /force revoke/i })).not.toBeInTheDocument();
  });
});
