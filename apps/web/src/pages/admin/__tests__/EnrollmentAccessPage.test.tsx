import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

// Recording httpsCallable mock: the REAL adminStore runs against it, so these
// tests pin the exact callable names + payloads the panel sends.
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  exemptions: [] as { email: string; note: string | null; createdByUid: string; createdAt: string | null }[],
  // The next call to this NAMED callable rejects with a FunctionsError-shaped Error.
  rejectNext: null as null | { name: string; code: string; message: string },
  preapproved: [] as { email: string; used: boolean }[],
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
    if (h.rejectNext && h.rejectNext.name === name) {
      const { code, message } = h.rejectNext;
      h.rejectNext = null;
      return Promise.reject(Object.assign(new Error(message), { code }));
    }
    switch (name) {
      case 'listPreapprovedEmails':
        return Promise.resolve({ data: { emails: [...h.preapproved] } });
      case 'listEnrollmentExemptions':
        return Promise.resolve({ data: { exemptions: [...h.exemptions] } });
      default:
        return Promise.resolve({ data: { success: true } });
    }
  },
}));

import i18n from '@/i18n';
import { ToastProvider } from '@ejm/shared-ui';
import { AdminEnrollmentAccessPage } from '../EnrollmentAccessPage';

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <MemoryRouter>
          <AdminEnrollmentAccessPage />
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
  h.rejectNext = null;
  h.preapproved = [];
});

afterEach(() => {
  cleanup();
});

describe('AdminEnrollmentAccessPage — enrollment exemptions panel', () => {
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

describe('AdminEnrollmentAccessPage — callable failure copy', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  });
  afterEach(() => alertSpy.mockRestore());

  function typeExemption() {
    fireEvent.change(screen.getByPlaceholderText(i18n.t('admin.exemptions.email')), {
      target: { value: 'kid28@ejm.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('admin.exemptions.add') }));
  }

  it('add pre-approved email: an unexpected fault alerts generic copy, never the raw token', async () => {
    h.rejectNext = { name: 'addPreapprovedEmail', code: 'functions/internal', message: 'internal' };
    renderPage();
    await screen.findByText(i18n.t('admin.noPreapprovedEmails'));
    fireEvent.change(screen.getByPlaceholderText(i18n.t('common.email')), {
      target: { value: 'x@ejm.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('admin.addEmail') }));

    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(i18n.t('common.error'));
    expect(alertSpy).not.toHaveBeenCalledWith('internal');
  });

  it('remove pre-approved email: an unexpected fault alerts generic copy', async () => {
    h.rejectNext = { name: 'removePreapprovedEmail', code: 'functions/internal', message: 'internal' };
    h.preapproved = [{ email: 'p@ejm.org', used: false }];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('common.remove') }));

    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(i18n.t('common.error'));
  });

  it('add exemption: an unexpected fault alerts generic copy, never the raw token', async () => {
    h.rejectNext = { name: 'setEnrollmentExemption', code: 'functions/internal', message: 'internal' };
    renderPage();
    await screen.findByText(i18n.t('admin.exemptions.empty'));
    typeExemption();

    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(i18n.t('common.error'));
    expect(alertSpy).not.toHaveBeenCalledWith('internal');
  });

  it('add exemption: invalid-argument maps to the check-the-email copy, not the server text', async () => {
    h.rejectNext = {
      name: 'setEnrollmentExemption',
      code: 'functions/invalid-argument',
      message: 'A valid email is required',
    };
    renderPage();
    await screen.findByText(i18n.t('admin.exemptions.empty'));
    typeExemption();

    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(i18n.t('admin.enrollmentAccess.invalidInput'));
  });

  it('add pre-approved email: invalid-argument maps to the check-the-email copy', async () => {
    h.rejectNext = {
      name: 'addPreapprovedEmail',
      code: 'functions/invalid-argument',
      message: 'Email is required',
    };
    renderPage();
    await screen.findByText(i18n.t('admin.noPreapprovedEmails'));
    fireEvent.change(screen.getByPlaceholderText(i18n.t('common.email')), {
      target: { value: 'x@ejm.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('admin.addEmail') }));

    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(i18n.t('admin.enrollmentAccess.invalidInput'));
  });

  it('remove exemption: an unexpected fault alerts generic copy', async () => {
    h.rejectNext = { name: 'removeEnrollmentExemption', code: 'functions/internal', message: 'internal' };
    h.exemptions = [{ email: 'e@ejm.org', note: null, createdByUid: 'a', createdAt: null }];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('admin.exemptions.remove') }));

    await vi.waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(i18n.t('common.error'));
  });
});
