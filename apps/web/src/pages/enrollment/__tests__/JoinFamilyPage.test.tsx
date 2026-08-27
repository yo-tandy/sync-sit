import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, render, cleanup, act } from '@testing-library/react';

// Issue #148: BOTH verifyParentEmail call sites (initial send + resend) must
// carry the sit app hint that selects the silent account-exists email copy.
// A dropped hint fails silently (normalized to 'sit' server-side for the
// wrong reasons), so these pins are the only guard.

const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  navigate: () => {},
}));

vi.mock('@/config/firebase', () => ({ auth: {}, functions: {}, db: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    if (name === 'validateInviteLink') {
      return Promise.resolve({ data: { familyName: 'Testers' } });
    }
    return Promise.resolve({ data: { success: true } });
  },
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(() => Promise.resolve()),
}));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => h.navigate,
  useParams: () => ({ token: 'invite-token-1' }),
}));
vi.mock('@/stores/authStore', () => {
  const storeState = () => ({
    firebaseUser: null,
    userDoc: null,
    loading: false,
    refreshUserDoc: () => Promise.resolve(),
  });
  return {
    useAuthStore: Object.assign(() => storeState(), {
      getState: () => storeState(),
      subscribe: () => () => {},
    }),
    markNextSignInFresh: () => {},
  };
});
vi.mock('@ejm/sit-core', () => ({
  getParentProfile: (userDoc: { profiles?: { parent?: unknown } } | null) =>
    userDoc?.profiles?.parent ?? null,
}));
vi.mock('@ejm/shared-ui', () => ({
  // The app's adminConfigClient wrapper instantiates this at import time
  // (issue #250) -- stub returns the caller's fallback (code default).
  createAdminConfigReader: () => ({
    getClientConfigValue: (_k: string, fallback: number) => Promise.resolve(fallback),
    __resetAdminConfigClientCacheForTests: () => {},
  }),
  enrollmentErrorReason: () => null,
}));
vi.mock('@/components/ui', () => ({
  TopNav: ({ title }: { title: string }) => <div>{title}</div>,
  StepIndicator: ({ currentStep }: { currentStep: number }) => <div>step-{currentStep}</div>,
  Spinner: () => <div>spinner</div>,
  Button: ({ onClick, disabled, children }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
  Input: ({ label, value, onChange }: { label: string; value: string; onChange: (e: { target: { value: string } }) => void }) => (
    <input aria-label={label} value={value} onChange={onChange} />
  ),
}));
vi.mock('@/components/ui/Icons', () => ({
  MailIcon: () => <span>mail-icon</span>,
}));
vi.mock('@/components/forms/CodeInput', () => ({
  CodeInput: () => <div>code-input</div>,
}));

import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import i18n from '@/i18n';
import { JoinFamilyPage } from '../JoinFamilyPage';

beforeEach(() => {
  cleanup();
  h.calls.length = 0;
  h.navigate = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('JoinFamilyPage verify payloads (issue #148)', () => {
  it('both the initial send and the resend call verifyParentEmail with the sit app hint', async () => {
    // Fake timers from the start so the resend-cooldown interval is created
    // under them and can be run down; promise flushes use `await act`.
    vi.useFakeTimers();
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <JoinFamilyPage />
        </MemoryRouter>
      </I18nextProvider>,
    );

    // Flush the invite validation promise, then the email step renders.
    await act(async () => {});
    const input = screen.getByLabelText('Email address *');
    fireEvent.change(input, { target: { value: 'invitee@test.com' } });
    fireEvent.click(screen.getByText('Send verification code'));
    await act(async () => {});

    const firstCall = h.calls.find((c) => c.name === 'verifyParentEmail');
    expect(firstCall).toBeTruthy();
    expect(firstCall!.payload).toMatchObject({ email: 'invitee@test.com', app: 'sit' });

    // Step 1 shows the 60s resend cooldown; run it down to reach the resend
    // link (the second call site).
    expect(screen.getByText('code-input')).toBeInTheDocument();

    // Round 5 (issue #148): the static "already have an account" exit hint is
    // always rendered under the code entry — identical on fresh and silent
    // paths, so it distinguishes nothing.
    expect(screen.getByText(/If you already have an account/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'log in' })).toHaveAttribute('href', '/login');
    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    fireEvent.click(screen.getByText('Resend code'));
    await act(async () => {});

    const resendCalls = h.calls.filter((c) => c.name === 'verifyParentEmail');
    expect(resendCalls).toHaveLength(2);
    expect(resendCalls[1].payload).toMatchObject({ email: 'invitee@test.com', app: 'sit' });
  });
});
