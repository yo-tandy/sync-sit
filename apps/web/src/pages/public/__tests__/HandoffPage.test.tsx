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
          <Route path="/account" element={<div>account hub</div>} />
          <Route path="/babysitter/account" element={<div>sitter profile</div>} />
          <Route path="/account/*" element={<div>account hub subpath</div>} />
          <Route path="/signup" element={<div>signup page</div>} />
          <Route path="/login" element={<div>login page</div>} />
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

  /**
   * sync-sit hosts the suite's ONE account hub, so study's and do's "My
   * account" tabs hand off here with `next=/account`. Same open-redirect rule
   * as study's receiver (#426): `next` is validated HERE against a fixed
   * table, and only the hub is on it.
   */
  describe('the `next` destination (one account hub)', () => {
    function mockSuccessfulRedemption() {
      h.callable.mockResolvedValue({ data: { token: 'custom-tok' } });
      h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
      h.getDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ uid: 'u1', profiles: { babysitter: { enrollmentComplete: true } } }),
      });
    }

    it('lands on the account hub when the handoff carries next=/account', async () => {
      window.location.hash = '#code=xyz&next=%2Faccount';
      mockSuccessfulRedemption();
      renderHandoff();
      await waitFor(() => expect(screen.getByText('account hub')).toBeInTheDocument());
      expect(screen.queryByText('sitter landing')).not.toBeInTheDocument();
    });

    it('accepts a path UNDER the hub (prefix rule)', async () => {
      window.location.hash = '#code=xyz&next=%2Faccount%2Fx';
      mockSuccessfulRedemption();
      renderHandoff();
      await waitFor(() => expect(screen.getByText('account hub subpath')).toBeInTheDocument());
    });

    it.each([
      // A REAL sit route, distinct from the default landing, so widening the
      // table to it would visibly change where the member lands.
      ['a real sit route not on the table', '%2Fbabysitter%2Faccount'],
      ['a lookalike prefix', '%2Faccounts'],
      ['scheme-relative', '%2F%2Fevil.com'],
      ['absolute URL with scheme', 'https%3A%2F%2Fevil.com'],
      ['javascript: URL', 'javascript%3Aalert(1)'],
      ['backslash-prefixed', '%2F%5Cevil.com'],
      ['percent-encoded scheme-relative', '/%252Fevil.com'],
      ['traversal out of the hub', '%2Faccount%2F..%2Fadmin'],
    ])('falls back to postLoginRouter when `next` is not allowed (%s)', async (_label, encodedNext) => {
      window.location.hash = `#code=xyz&next=${encodedNext}`;
      mockSuccessfulRedemption();
      renderHandoff();
      await waitFor(() => expect(screen.getByText('sitter landing')).toBeInTheDocument());
      expect(screen.queryByText('sitter profile')).not.toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain('evil.com');
      expect(document.body.innerHTML).not.toContain('javascript:');
      expect(window.location.hash).toBe('');
    });

    it('honours next=/account even when the user-doc read fails after sign-in', async () => {
      // A study-only or do-only member, or a transient read failure: the hub
      // admits any signed-in member, so the deep link still applies.
      window.location.hash = '#code=xyz&next=%2Faccount';
      h.callable.mockResolvedValue({ data: { token: 'tok' } });
      h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
      h.getDoc.mockRejectedValue(new Error('transient'));
      renderHandoff();
      await waitFor(() => expect(screen.getByText('account hub')).toBeInTheDocument());
    });

    it('a valid next never overrides a FAILED redemption', async () => {
      window.location.hash = '#code=bad&next=%2Faccount';
      h.callable.mockRejectedValue(new Error('nope'));
      renderHandoff();
      await waitFor(() => expect(screen.getByText(/this link has expired/i)).toBeInTheDocument());
      expect(screen.queryByText('account hub')).not.toBeInTheDocument();
      expect(h.signInWithCustomToken).not.toHaveBeenCalled();
    });
  });
});
