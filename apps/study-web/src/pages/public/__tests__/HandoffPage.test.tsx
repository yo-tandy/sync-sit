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

vi.mock('@/config/firebase', () => ({ auth: { tag: 'study-auth' }, db: {}, functions: {} }));
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
          <Route path="/tutor" element={<div>tutor landing</div>} />
          <Route path="/signup" element={<div>signup page</div>} />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('HandoffPage (study)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

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
      data: () => ({ uid: 'u1', profiles: { tutor: { enrollmentComplete: true } } }),
    });

    renderHandoff();

    await waitFor(() => expect(screen.getByText('tutor landing')).toBeInTheDocument());
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
      data: () => ({ uid: 'u1', profiles: { tutor: { enrollmentComplete: true } } }),
    });
    renderHandoff();
    // The full success path runs (not a failure branch) with the language applied.
    await waitFor(() => expect(screen.getByText('tutor landing')).toBeInTheDocument());
    expect(i18n.language).toBe('fr');
  });

  it('ignores an unknown lang value (allowlist pin)', async () => {
    await i18n.changeLanguage('en');
    window.location.hash = '#code=xyz&lang=de';
    h.callable.mockResolvedValue({ data: { token: 'custom-tok' } });
    h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
    h.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ uid: 'u1', profiles: { tutor: { enrollmentComplete: true } } }),
    });
    renderHandoff();
    await waitFor(() => expect(screen.getByText('tutor landing')).toBeInTheDocument());
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
      data: () => ({ uid: 'u1', profiles: { tutor: { enrollmentComplete: true } } }),
    });

    renderHandoff();

    await waitFor(() => expect(screen.getByText('tutor landing')).toBeInTheDocument());
    expect(h.callable).toHaveBeenCalledWith('redeemAppHandoffCode', { code: 'fresh' });
    expect(h.signInWithCustomToken).toHaveBeenCalledTimes(1);
  });

  it('redeems exactly ONCE across a StrictMode-style double mount', async () => {
    window.location.hash = '#code=once';
    h.callable.mockResolvedValue({ data: { token: 'custom-tok' } });
    h.signInWithCustomToken.mockResolvedValue({ user: { uid: 'u1' } });
    h.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ uid: 'u1', profiles: { tutor: { enrollmentComplete: true } } }),
    });

    // Mount, unmount immediately (mid-flight), mount again — the second mount
    // must await the SAME one-shot, not re-redeem the one-time code.
    const first = renderHandoff();
    first.unmount();
    renderHandoff();

    await waitFor(() => expect(screen.getByText('tutor landing')).toBeInTheDocument());
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
    // The one-shot settled and cleared: a fragment-less visit never calls the
    // backend (and never replays a previously stashed code).
    expect(h.callable).not.toHaveBeenCalled();
  });
});
