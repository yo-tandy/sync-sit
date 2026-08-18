import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Routes, Route } from 'react-router';

const h = vi.hoisted(() => ({
  callable: vi.fn(),
  signInWithCustomToken: vi.fn(),
  markNextSignInFresh: vi.fn(),
  getDoc: vi.fn(),
  setState: vi.fn(),
  state: {
    firebaseUser: null as unknown,
    userDoc: null as unknown,
    loading: false,
  },
}));

vi.mock('@/config/firebase', () => ({ auth: { tag: 'sit-auth' }, db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload?: unknown) => h.callable(name, payload),
}));
vi.mock('firebase/auth', () => ({
  signInWithCustomToken: (...args: unknown[]) => h.signInWithCustomToken(...args),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ col, id }),
  getDoc: (ref: unknown) => h.getDoc(ref),
}));
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => h.state;
  useAuthStore.getState = () => h.state;
  useAuthStore.setState = h.setState;
  return { useAuthStore, markNextSignInFresh: h.markNextSignInFresh };
});

import i18n from '@/i18n';
import { HandoffPage } from '../HandoffPage';

function renderHandoff() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/handoff']}>
        <Routes>
          <Route path="/handoff" element={<HandoffPage />} />
          <Route path="/babysitter" element={<div>sitter landing</div>} />
          <Route path="/family/verification" element={<div>verification page</div>} />
          <Route path="/signup" element={<div>signup page</div>} />
          <Route path="/login" element={<div>login page</div>} />
          <Route path="*" element={<div>catch-all landing</div>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('HandoffPage (sit)', () => {
  // apps/web's vitest setup does not auto-cleanup (globals: false).
  afterEach(() => cleanup());

  beforeEach(() => {
    h.callable.mockReset();
    h.signInWithCustomToken.mockReset();
    h.markNextSignInFresh.mockReset();
    h.getDoc.mockReset();
    h.setState.mockReset();
    h.state.firebaseUser = null;
    h.state.userDoc = null;
    window.history.replaceState(null, '', '/handoff');
    window.location.hash = '';
  });

  it('redeems the fragment code, signs in, and lands on the role home — fragment stripped first', async () => {
    window.location.hash = '#code=xyz';
    let hashAtRedeem: string | null = null;
    h.callable.mockImplementation(async () => {
      hashAtRedeem = window.location.hash;
      return { data: { token: 'custom-tok' } };
    });
    h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
    h.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ uid: 'u1', profiles: { babysitter: { enrollmentComplete: true } } }),
    });

    renderHandoff();

    await waitFor(() => expect(screen.getByText('sitter landing')).toBeInTheDocument());
    expect(h.callable).toHaveBeenCalledWith('redeemAppHandoffCode', { code: 'xyz' });
    // The fragment was stripped BEFORE any network call, and stays stripped.
    expect(hashAtRedeem).toBe('');
    expect(window.location.hash).toBe('');
    // The custom token from the redeem response is what signs us in.
    expect(h.signInWithCustomToken).toHaveBeenCalledTimes(1);
    expect(h.signInWithCustomToken.mock.calls[0][1]).toBe('custom-tok');
    // Issue #181 pin: the handoff sign-in captures the session epoch — the
    // fresh-sign-in mark must land BEFORE the custom-token sign-in.
    expect(h.markNextSignInFresh).toHaveBeenCalledTimes(1);
    expect(h.markNextSignInFresh.mock.invocationCallOrder[0]).toBeLessThan(
      h.signInWithCustomToken.mock.invocationCallOrder[0],
    );
  });

  it('applies the carried lang on arrival and completes the REAL handoff in it', async () => {
    await i18n.changeLanguage('en');
    window.location.hash = '#code=xyz&lang=fr';
    h.callable.mockResolvedValue({ data: { token: 'custom-tok' } });
    h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
    h.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ uid: 'u1', profiles: { babysitter: { enrollmentComplete: true } } }),
    });
    renderHandoff();
    await waitFor(() => expect(screen.getByText('sitter landing')).toBeInTheDocument());
    expect(i18n.language).toBe('fr');
    await i18n.changeLanguage('en');
  });

  it('ignores an unknown lang value (allowlist pin)', async () => {
    await i18n.changeLanguage('en');
    window.location.hash = '#code=xyz&lang=de';
    h.callable.mockResolvedValue({ data: { token: 'custom-tok' } });
    h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
    h.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ uid: 'u1', profiles: { babysitter: { enrollmentComplete: true } } }),
    });
    renderHandoff();
    await waitFor(() => expect(screen.getByText('sitter landing')).toBeInTheDocument());
    expect(i18n.language).toBe('en');
  });

  it('still redeems + signs in when a user is ALREADY signed in (handoff wins)', async () => {
    h.state.firebaseUser = { uid: 'previous-user' };
    h.state.userDoc = { uid: 'previous-user', profiles: { parent: { familyId: 'f' } } };
    window.location.hash = '#code=fresh';
    h.callable.mockResolvedValue({ data: { token: 'tok2' } });
    h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
    h.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ uid: 'u1', profiles: { babysitter: { enrollmentComplete: true } } }),
    });

    renderHandoff();

    await waitFor(() => expect(screen.getByText('sitter landing')).toBeInTheDocument());
    expect(h.callable).toHaveBeenCalledWith('redeemAppHandoffCode', { code: 'fresh' });
    expect(h.signInWithCustomToken).toHaveBeenCalledTimes(1);
  });

  it('redeems exactly ONCE across a StrictMode-style double mount', async () => {
    window.location.hash = '#code=once';
    h.callable.mockResolvedValue({ data: { token: 'custom-tok' } });
    h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
    h.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ uid: 'u1', profiles: { babysitter: { enrollmentComplete: true } } }),
    });

    const first = renderHandoff();
    first.unmount();
    renderHandoff();

    await waitFor(() => expect(screen.getByText('sitter landing')).toBeInTheDocument());
    const redeems = h.callable.mock.calls.filter(([n]) => n === 'redeemAppHandoffCode');
    expect(redeems).toHaveLength(1);
  });

  it('renders the friendly error screen with a login link when redemption fails', async () => {
    window.location.hash = '#code=bad';
    h.callable.mockRejectedValue(new Error('nope'));

    renderHandoff();

    await waitFor(() =>
      expect(screen.getByText(/this link has expired/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: /log ?in/i })).toHaveAttribute('href', '/login');
    expect(h.signInWithCustomToken).not.toHaveBeenCalled();
  });

  it('a user-doc failure AFTER sign-in lands signed in on the default entrance, not the error screen', async () => {
    window.location.hash = '#code=xyz';
    h.callable.mockResolvedValue({ data: { token: 'tok' } });
    h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
    // Sign-in succeeded, so the code is consumed — a transient doc-read
    // failure must not strand a signed-in user on "switch again".
    h.getDoc.mockRejectedValue(new Error('transient'));

    renderHandoff();

    await waitFor(() => expect(screen.getByText('signup page')).toBeInTheDocument());
    expect(h.setState).toHaveBeenCalledWith({
      firebaseUser: { uid: 'u1' },
      userDoc: null,
      loading: false,
    });
    expect(screen.queryByText(/this link has expired/i)).not.toBeInTheDocument();
  });

  it('honors a valid RELATIVE deep-link destination over the role landing', async () => {
    window.location.hash = '#code=xyz&dest=%2Ffamily%2Fverification';
    h.callable.mockResolvedValue({ data: { token: 'custom-tok' } });
    h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
    h.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ uid: 'u1', profiles: { babysitter: { enrollmentComplete: true } } }),
    });

    renderHandoff();

    // The deep link wins over postLoginRouter's /babysitter landing.
    await waitFor(() => expect(screen.getByText('verification page')).toBeInTheDocument());
    expect(h.signInWithCustomToken).toHaveBeenCalledTimes(1);
  });

  // The destination is attacker-visible URL surface and never touches the
  // server — this allowlist-shape check is the ONLY defense against an open
  // redirect through the auth handoff. Every hostile shape must degrade to
  // the default role landing, never navigate.
  it.each([
    ['absolute URL', 'https://evil.com'],
    ['protocol-relative', '//evil.com'],
    ['scheme', 'javascript:alert(1)'],
    ['backslash protocol-relative', '/\\evil.com'],
    ['backslash anywhere', '/family\\..\\evil'],
    ['missing leading slash', 'family/verification'],
  ])('REJECTS a hostile destination (%s) and lands on the default', async (_label, dest) => {
    window.location.hash = `#code=xyz&dest=${encodeURIComponent(dest)}`;
    h.callable.mockResolvedValue({ data: { token: 'custom-tok' } });
    h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
    h.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ uid: 'u1', profiles: { babysitter: { enrollmentComplete: true } } }),
    });

    renderHandoff();

    await waitFor(() => expect(screen.getByText('sitter landing')).toBeInTheDocument());
    expect(screen.queryByText('catch-all landing')).not.toBeInTheDocument();
  });

  it('a hostile destination on the degraded (user-doc failure) path also lands on the default entrance', async () => {
    window.location.hash = '#code=xyz&dest=%2F%2Fevil.com';
    h.callable.mockResolvedValue({ data: { token: 'tok' } });
    h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
    h.getDoc.mockRejectedValue(new Error('transient'));

    renderHandoff();

    await waitFor(() => expect(screen.getByText('signup page')).toBeInTheDocument());
  });

  it('a missing code renders the IDENTICAL error screen (no oracle in the UI)', async () => {
    // Failure case first.
    window.location.hash = '#code=bad';
    h.callable.mockRejectedValue(new Error('nope'));
    const { container: failed } = renderHandoff();
    await waitFor(() => expect(screen.getByText(/this link has expired/i)).toBeInTheDocument());
    const failedHtml = failed.innerHTML;
    cleanup();

    // Missing code: no callable involved, same markup.
    window.location.hash = '';
    h.callable.mockClear();
    const { container: missing } = renderHandoff();
    await waitFor(() => expect(screen.getByText(/this link has expired/i)).toBeInTheDocument());
    expect(missing.innerHTML).toBe(failedHtml);
    expect(h.callable).not.toHaveBeenCalled();
  });
});
