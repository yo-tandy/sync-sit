import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  TOS_VERSION,
  PRIVACY_POLICY_VERSION,
  SUPERVISION_AGREEMENT_VERSION,
} from '@ejm/shared-core';

const h = vi.hoisted(() => ({
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
import { CreateKidInvitePage } from '../CreateKidInvitePage';

/** current-year+2 is inside the valid graduation-year window in every month. */
const VALID_EMAIL = `noa${(new Date().getFullYear() % 100) + 2}@ejm.org`;

function renderPage() {
  return render(
    <MemoryRouter>
      <CreateKidInvitePage />
    </MemoryRouter>,
  );
}

function fillIdentity(email = VALID_EMAIL) {
  fireEvent.change(screen.getByLabelText(/ejm email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Noa' } });
  fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Weiss' } });
  fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '2012-05-01' } });
}

function checkConsents() {
  fireEvent.click(screen.getByRole('checkbox', { name: /terms of service/i }));
  fireEvent.click(screen.getByRole('checkbox', { name: /privacy policy/i }));
  fireEvent.click(screen.getByRole('checkbox', { name: /supervision agreement/i }));
}

const submitButton = () => screen.getByRole('button', { name: /send invitation/i });

function reset() {
  i18n.changeLanguage('en');
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { success: true } });
}

describe('CreateKidInvitePage (sit)', () => {
  beforeEach(() => reset());
  afterEach(() => cleanup());

  it('links each consent to its document', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /terms of service/i })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('link', { name: /supervision agreement/i })).toHaveAttribute(
      'href',
      '/supervision-agreement',
    );
  });

  it('keeps submit disabled until all three consents are checked', () => {
    renderPage();
    fillIdentity();
    expect(submitButton()).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /terms of service/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /privacy policy/i }));
    expect(submitButton()).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /supervision agreement/i }));
    expect(submitButton()).toBeEnabled();
  });

  it('shows an inline error for a non-EJM email and never calls the callable', () => {
    renderPage();
    fillIdentity('kid@gmail.com');
    checkConsents();

    expect(screen.getByText(/@ejm.org/i)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    expect(h.callable).not.toHaveBeenCalled();
  });

  it('submits the payload with consent versions VERBATIM from shared-core', async () => {
    renderPage();
    fillIdentity();
    checkConsents();
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('createKidInvite', {
        kidEmail: VALID_EMAIL,
        firstName: 'Noa',
        lastName: 'Weiss',
        dateOfBirth: '2012-05-01',
        consent: {
          tosVersion: TOS_VERSION,
          privacyVersion: PRIVACY_POLICY_VERSION,
          supervisionAgreementVersion: SUPERVISION_AGREEMENT_VERSION,
        },
      }),
    );
  });

  // ── THE anti-enumeration pin ──────────────────────────────────────────────
  // Whatever the backend resolves with, the parent sees ONE identical screen.
  // Two deliberately different mocked resolutions (a bare success and a
  // hypothetically leaky payload) must produce byte-identical markup.
  it('renders one identical success screen regardless of the backend branch', async () => {
    const renderToSuccess = async (resolution: Record<string, unknown>) => {
      h.callable.mockReset();
      h.callable.mockResolvedValue({ data: resolution });
      const { container, unmount } = renderPage();
      fillIdentity();
      checkConsents();
      fireEvent.click(submitButton());
      await screen.findByText(/invitation sent/i);
      const html = container.innerHTML;
      unmount();
      cleanup();
      return html;
    };

    const bareSuccess = await renderToSuccess({ success: true });
    const leakySuccess = await renderToSuccess({
      success: true,
      branch: 'claim_requested',
      childUid: 'c1',
    });

    expect(bareSuccess).toBe(leakySuccess);
    expect(bareSuccess).toContain('/family/governance');
  });

  it('explains the uniform screen and never reveals account existence', async () => {
    renderPage();
    fillIdentity();
    checkConsents();
    fireEvent.click(submitButton());

    await screen.findByText(/invitation sent/i);
    // The neutral by-design sentence.
    expect(
      screen.getByText(/we don't reveal whether an account already exists/i),
    ).toBeInTheDocument();
    // Back-to-dashboard CTA.
    expect(screen.getByRole('link', { name: /back to/i })).toHaveAttribute(
      'href',
      '/family/governance',
    );
  });

  it('maps guardian/not-a-family-parent to the needs-family explainer', async () => {
    h.callable.mockRejectedValue({
      code: 'functions/permission-denied',
      details: { code: 'guardian/not-a-family-parent' },
    });
    renderPage();
    fillIdentity();
    checkConsents();
    fireEvent.click(submitButton());

    expect(await screen.findByText(/a family profile is needed first/i)).toBeInTheDocument();
    expect(screen.queryByText(/invitation sent/i)).not.toBeInTheDocument();
  });
});
