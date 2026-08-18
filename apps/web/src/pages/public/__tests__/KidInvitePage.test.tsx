import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

// The redemption page is PUBLIC and unauthenticated: it calls redeemKidInvite
// with the URL token, then signs the kid in exactly like sit enrollment does
// after account creation (signInWithEmailAndPassword + auth-store wait).
const h = vi.hoisted(() => ({
  callable: vi.fn(),
  signIn: vi.fn(() => Promise.resolve()),
  authState: {
    loading: false,
    userDoc: { uid: 'kid1' } as Record<string, unknown> | null,
    firebaseUser: null as Record<string, unknown> | null,
  },
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload?: unknown) => h.callable(name, payload),
}));

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...args: unknown[]) => h.signIn(...args),
}));

// Mirrors the zustand static API the enrollment sign-in wait uses.
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => h.authState;
  useAuthStore.getState = () => h.authState;
  useAuthStore.subscribe = () => () => {};
  return { useAuthStore, markNextSignInFresh: () => {} };
});

import i18n from '@/i18n';
import { KidInvitePage } from '../KidInvitePage';

function renderPage(url = '/kid-invite?token=tok-123') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/kid-invite" element={<KidInvitePage />} />
        <Route path="/enroll/babysitter" element={<div>ENROLL_LANDING</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillPasswords(pw = 'Passw0rd!') {
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: pw } });
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: pw } });
}

const submitButton = () => screen.getByRole('button', { name: /create.*account/i });

function reset() {
  i18n.changeLanguage('en');
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { success: true, uid: 'kid1', email: 'noa28@ejm.org' } });
  h.signIn.mockClear();
  h.authState.loading = false;
  h.authState.userDoc = { uid: 'kid1' };
}

describe('KidInvitePage', () => {
  beforeEach(() => reset());
  afterEach(() => cleanup());

  it('explains the supervised account and links the governing documents', () => {
    renderPage();
    expect(screen.getByText(/a parent created this account/i)).toBeInTheDocument();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/terms');
    expect(hrefs).toContain('/privacy');
    expect(hrefs).toContain('/supervision-info');
  });

  it('keeps submit disabled until the password is strong and confirmed', () => {
    renderPage();
    expect(submitButton()).toBeDisabled();

    // Weak password (no uppercase, no number) never enables submit.
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'weakpass' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'weakpass' } });
    expect(submitButton()).toBeDisabled();

    // Strong but unconfirmed → still disabled.
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Passw0rd!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: '' } });
    expect(submitButton()).toBeDisabled();

    fillPasswords();
    expect(submitButton()).toBeEnabled();
  });

  it('pins the URL token in the redeemKidInvite payload', async () => {
    renderPage('/kid-invite?token=tok-abc');
    fillPasswords();
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('redeemKidInvite', {
        token: 'tok-abc',
        password: 'Passw0rd!',
      }),
    );
  });

  it('signs the kid in with the returned email and navigates to enrollment', async () => {
    renderPage();
    fillPasswords();
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(h.signIn).toHaveBeenCalledWith(expect.anything(), 'noa28@ejm.org', 'Passw0rd!'),
    );
    expect(await screen.findByText('ENROLL_LANDING')).toBeInTheDocument();
  });

  it('shows ONE generic ask-your-parent screen for any rejected token', async () => {
    h.callable.mockRejectedValue({
      code: 'functions/not-found',
      details: { code: 'guardian/invalid-invite' },
    });
    renderPage();
    fillPasswords();
    fireEvent.click(submitButton());

    expect(await screen.findByText(/ask your parent to send a new one/i)).toBeInTheDocument();
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it('shows the same friendly screen when the URL has no token, without calling the backend', () => {
    renderPage('/kid-invite');
    expect(screen.getByText(/ask your parent to send a new one/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument();
    expect(h.callable).not.toHaveBeenCalled();
  });
});
