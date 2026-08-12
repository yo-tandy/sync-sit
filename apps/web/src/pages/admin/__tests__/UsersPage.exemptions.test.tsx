import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

// Recording httpsCallable mock: the REAL adminStore runs against it, so these
// tests pin the exact callable names + payloads the panel sends.
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  exemptions: [] as { email: string; note: string | null; createdByUid: string; createdAt: string | null }[],
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {} }));
// The ui barrel (ToastProvider path) pulls the auth store, whose module scope
// subscribes onAuthStateChanged — neutralize it like sibling tests do.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ userDoc: null, firebaseUser: null }),
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    switch (name) {
      case 'listUsers':
        return Promise.resolve({ data: { users: [] } });
      case 'listPreapprovedEmails':
        return Promise.resolve({ data: { emails: [] } });
      case 'listEnrollmentExemptions':
        return Promise.resolve({ data: { exemptions: [...h.exemptions] } });
      default:
        return Promise.resolve({ data: { success: true } });
    }
  },
}));

import i18n from '@/i18n';
import { ToastProvider } from '@ejm/shared-ui';
import { AdminUsersPage } from '../UsersPage';

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <MemoryRouter>
          <AdminUsersPage />
        </MemoryRouter>
      </ToastProvider>
    </I18nextProvider>,
  );
}

function exemptionCalls(name: string) {
  return h.calls.filter((c) => c.name === name);
}

beforeEach(() => {
  i18n.changeLanguage('en');
  h.calls.length = 0;
  h.exemptions = [];
});

afterEach(() => {
  cleanup();
});

describe('AdminUsersPage — enrollment exemptions panel', () => {
  it('lists exemptions from listEnrollmentExemptions on mount (email + note shown)', async () => {
    h.exemptions = [
      { email: 'redoublant29@ejm.org', note: 'repeated a year', createdByUid: 'admin1', createdAt: null },
    ];
    renderPage();

    expect(await screen.findByText('redoublant29@ejm.org')).toBeInTheDocument();
    expect(screen.getByText('repeated a year')).toBeInTheDocument();
    expect(exemptionCalls('listEnrollmentExemptions')[0]?.payload).toEqual({});
  });

  it('shows the empty state when there are no exemptions', async () => {
    renderPage();
    expect(await screen.findByText(i18n.t('admin.exemptions.empty'))).toBeInTheDocument();
  });

  it('adds an exemption with email + note, then refreshes the list (non-optimistic)', async () => {
    renderPage();
    await screen.findByText(i18n.t('admin.exemptions.empty'));

    fireEvent.change(screen.getByPlaceholderText(i18n.t('admin.exemptions.email')), {
      target: { value: 'Redoublant29@ejm.org' },
    });
    fireEvent.change(screen.getByPlaceholderText(i18n.t('admin.exemptions.note')), {
      target: { value: 'repeated a year' },
    });
    // The refreshed list (not local state) must supply the rendered row.
    h.exemptions = [
      { email: 'redoublant29@ejm.org', note: 'repeated a year', createdByUid: 'admin1', createdAt: null },
    ];
    fireEvent.click(screen.getByRole('button', { name: i18n.t('admin.exemptions.add') }));

    expect(await screen.findByText('redoublant29@ejm.org')).toBeInTheDocument();
    expect(exemptionCalls('setEnrollmentExemption')).toHaveLength(1);
    expect(exemptionCalls('setEnrollmentExemption')[0].payload).toEqual({
      email: 'Redoublant29@ejm.org',
      note: 'repeated a year',
    });
    // list → mutation → list again.
    expect(exemptionCalls('listEnrollmentExemptions')).toHaveLength(2);
    // Inputs cleared after a successful add.
    expect(screen.getByPlaceholderText(i18n.t('admin.exemptions.email'))).toHaveValue('');
    expect(screen.getByPlaceholderText(i18n.t('admin.exemptions.note'))).toHaveValue('');
    // Confirmation toast (shared idiom) after the refetch resolved.
    expect(await screen.findByRole('status')).toHaveTextContent(i18n.t('admin.exemptions.added'));
  });

  it('omits the note key entirely when the note is empty', async () => {
    renderPage();
    await screen.findByText(i18n.t('admin.exemptions.empty'));

    fireEvent.change(screen.getByPlaceholderText(i18n.t('admin.exemptions.email')), {
      target: { value: 'kid28@ejm.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('admin.exemptions.add') }));

    await vi.waitFor(() => expect(exemptionCalls('setEnrollmentExemption')).toHaveLength(1));
    // Exact payload: no note key (undefined would serialize as null and break
    // the backend's zod .optional()).
    expect(exemptionCalls('setEnrollmentExemption')[0].payload).toEqual({ email: 'kid28@ejm.org' });
  });

  it('removes an exemption then refreshes the list (non-optimistic)', async () => {
    h.exemptions = [
      { email: 'redoublant29@ejm.org', note: null, createdByUid: 'admin1', createdAt: null },
    ];
    renderPage();
    await screen.findByText('redoublant29@ejm.org');

    h.exemptions = [];
    fireEvent.click(screen.getByRole('button', { name: i18n.t('admin.exemptions.remove') }));

    expect(await screen.findByText(i18n.t('admin.exemptions.empty'))).toBeInTheDocument();
    expect(exemptionCalls('removeEnrollmentExemption')).toHaveLength(1);
    expect(exemptionCalls('removeEnrollmentExemption')[0].payload).toEqual({
      email: 'redoublant29@ejm.org',
    });
    expect(exemptionCalls('listEnrollmentExemptions')).toHaveLength(2);
    // Confirmation toast (shared idiom) after the refetch resolved.
    expect(await screen.findByRole('status')).toHaveTextContent(i18n.t('admin.exemptions.removed'));
  });
});
