import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, render, cleanup } from '@testing-library/react';

// Hoisted shared state the mocks record into (mirrors the study wizard test).
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  navigate: () => {},
  auth: {
    firebaseUser: null as unknown,
    userDoc: null as Record<string, unknown> | null,
    loading: false,
  },
  refreshUserDoc: () => Promise.resolve(),
  // Controllable verifyEjmEmail rejection so tests can drive the send-cap
  // (issue #155 bypass allowance) branch. Default null = send succeeds.
  verifyError: null as { code: string; details: { reason: string } } | null,
  // Admin-config values the reader stub serves (issue #250) -- empty means
  // every key resolves to its caller-supplied fallback (code default).
  configValues: {} as Record<string, number>,
}));

vi.mock('@/config/firebase', () => ({ auth: {}, functions: {}, db: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    // Model the send-cap rejection (issue #155): HttpsError
    // ('failed-precondition', msg, { reason: 'send-cap' }) surfaces as a
    // FunctionsError with details.reason.
    if (name === 'verifyEjmEmail' && h.verifyError) {
      return Promise.reject(h.verifyError);
    }
    return Promise.resolve({ data: { uid: 'u1' } });
  },
}));
vi.mock('firebase/auth', () => ({
  // Model the real sign-in: the auth store ends up with the fresh minimal doc
  // (no identity yet) so the post-sign-in wait in handleCreateAccount resolves.
  signInWithEmailAndPassword: vi.fn(() => {
    h.auth = {
      firebaseUser: { uid: 'u1' },
      userDoc: { profiles: { babysitter: { enrollmentComplete: false } } },
      loading: false,
    };
    return Promise.resolve();
  }),
}));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => h.navigate,
}));
vi.mock('@/stores/authStore', () => {
  const storeState = () => ({
    firebaseUser: h.auth.firebaseUser,
    userDoc: h.auth.userDoc,
    loading: h.auth.loading,
    refreshUserDoc: h.refreshUserDoc,
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
  getBabysitterProfile: (userDoc: { profiles?: { babysitter?: unknown } } | null) =>
    userDoc?.profiles?.babysitter ?? null,
}));

// Lightweight stand-ins for the child step components.
vi.mock('@ejm/shared-ui', () => ({
  // The app's adminConfigClient wrapper instantiates this at import time
  // (issue #250) -- stub returns the caller's fallback (code default).
  createAdminConfigReader: () => ({
    getClientConfigValue: (k: string, fallback: number) =>
      Promise.resolve(h.configValues[k] ?? fallback),
    // The hook lives on the factory too (round-7 consolidation).
    useClientConfigValue: (k: string, fallback: number) => h.configValues[k] ?? fallback,
    __resetAdminConfigClientCacheForTests: () => {},
  }),
  // Mirrors the real helper: read details.reason off the rejected value.
  enrollmentErrorReason: (err: { details?: { reason?: unknown } } | null) => {
    const reason = err?.details?.reason;
    return reason === 'profile-exists' || reason === 'role-exclusive' || reason === 'send-cap'
      ? reason
      : null;
  },
  StepEmail: ({ onSubmit, error }: { onSubmit: () => void; error?: string | null }) => (
    <div>
      {error && <p>{error}</p>}
      <button onClick={onSubmit}>email-submit</button>
    </div>
  ),
  StepVerify: ({ onVerify, resendCooldownS }: { onVerify: (c: string) => void; resendCooldownS?: number }) => (
    <div>
      <span data-testid="resend-cooldown-s">{resendCooldownS}</span>
      <button onClick={() => onVerify('123456')}>verify-submit</button>
    </div>
  ),
  StepPassword: (props: { onSubmit: (pw: string, c: string) => void; collectPassword?: boolean }) => (
    <button
      data-testid="step-password"
      data-collect={String(props.collectPassword)}
      onClick={() => props.onSubmit('Pw123456!', '1.0')}
    >
      password-submit
    </button>
  ),
}));
vi.mock('@/components/ui', () => ({
  TopNav: ({ title }: { title: string }) => <div>{title}</div>,
  StepIndicator: ({ currentStep }: { currentStep: number }) => <div>step-{currentStep}</div>,
}));
vi.mock('@/components/ui/EnrollmentAppBar', () => ({
  EnrollmentAppBar: () => <div>enrollment-app-bar</div>,
}));
vi.mock('../babysitter/StepProfile', () => ({
  StepProfile: ({ onNext }: { onNext: () => void }) => (
    <button onClick={onNext}>profile-next</button>
  ),
}));
vi.mock('../babysitter/StepPreferences', () => ({
  StepPreferences: ({ onComplete }: { onComplete: () => void }) => (
    <button onClick={onComplete}>preferences-complete</button>
  ),
}));

import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import i18n from '@/i18n';
import { BabysitterEnrollment } from '../BabysitterEnrollment';

function renderFlow() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <BabysitterEnrollment />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

async function driveThroughAccountStep() {
  fireEvent.click(screen.getByText('email-submit'));
  fireEvent.click(await screen.findByText('verify-submit'));
  fireEvent.click(await screen.findByTestId('step-password'));
}

beforeEach(() => {
  cleanup();
  h.calls.length = 0;
  h.navigate = vi.fn();
  h.auth = { firebaseUser: null, userDoc: null, loading: false };
  h.refreshUserDoc = vi.fn().mockResolvedValue(undefined);
  h.verifyError = null;
  h.configValues = {};
  i18n.changeLanguage('en');
});

describe('BabysitterEnrollment send-cap surfacing (issue #155)', () => {
  it("verifyEjmEmail 'send-cap' rejection renders the translated copy and stays on the email step", async () => {
    h.verifyError = { code: 'functions/failed-precondition', details: { reason: 'send-cap' } };
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));

    const msg = i18n.t('enrollment.sendCapReached');
    expect(await screen.findByText(msg)).toBeInTheDocument();
    // No advance to the verify step, and no raw English backend string.
    expect(screen.queryByText('verify-submit')).toBeNull();
    expect(
      screen.queryByText(/Too many verification emails requested for this account/),
    ).toBeNull();
  });
});

// Issue #144: a cross-app user (study tutor adding a babysitter profile)
// already carries firstName/lastName/dateOfBirth. They still pass through
// StepProfile — it owes classLevel/gender — but the step renders their
// identity as a read-only summary instead of inputs (pinned in
// StepProfile.test.tsx); nothing is re-asked and the set-once rules deny
// any identity rewrite. Routing distinguishes on the PROFILE-scoped
// classLevel marker, not root identity.
describe('BabysitterEnrollment add-profile routing (issue #144)', () => {
  it('add-profile with existing identity still passes StepProfile (classLevel is owed)', async () => {
    h.auth = {
      firebaseUser: { uid: 't1' },
      userDoc: { firstName: 'Iris', lastName: 'Martin', dateOfBirth: '2008-01-15', profiles: { tutor: {} } },
      loading: false,
    };
    h.refreshUserDoc = vi.fn().mockImplementation(() => {
      h.auth.userDoc = {
        ...h.auth.userDoc,
        profiles: { tutor: {}, babysitter: { enrollmentComplete: false } },
      };
      return Promise.resolve();
    });
    renderFlow();

    await driveThroughAccountStep();

    expect(await screen.findByText('profile-next')).toBeInTheDocument();
    expect(screen.queryByText('preferences-complete')).toBeNull();
    expect(h.refreshUserDoc).toHaveBeenCalled();
    expect(h.calls.some((c) => c.name === 'enrollBabysitter')).toBe(true);
  });

  it('RESUME with identity on file but NO classLevel goes to StepProfile (discriminating pin)', async () => {
    // This fixture separates the predicates: the old routing
    // (!userDoc.firstName) would send this user to preferences and lose
    // classLevel forever; the shipped routing (!babysitter.classLevel)
    // sends them through StepProfile. It exercises the RESUME effect, not
    // the post-create transition (which is unconditional).
    h.auth = {
      firebaseUser: { uid: 't4' },
      userDoc: {
        firstName: 'Iris',
        lastName: 'Martin',
        dateOfBirth: '2008-01-15',
        profiles: { tutor: {}, babysitter: { enrollmentComplete: false } },
      },
      loading: false,
    };
    renderFlow();

    expect(await screen.findByText('profile-next')).toBeInTheDocument();
    expect(screen.queryByText('preferences-complete')).toBeNull();
  });

  it('resume with classLevel already collected goes straight to preferences', async () => {
    h.auth = {
      firebaseUser: { uid: 't3' },
      userDoc: {
        firstName: 'Iris',
        profiles: { babysitter: { enrollmentComplete: false, classLevel: 'Terminale' } },
      },
      loading: false,
    };
    renderFlow();

    expect(await screen.findByText('preferences-complete')).toBeInTheDocument();
    expect(screen.queryByText('profile-next')).toBeNull();
  });

  it('add-profile WITHOUT identity still gets the identity step', async () => {
    h.auth = {
      firebaseUser: { uid: 't2' },
      userDoc: { profiles: {} },
      loading: false,
    };
    h.refreshUserDoc = vi.fn().mockImplementation(() => {
      h.auth.userDoc = { profiles: { babysitter: { enrollmentComplete: false } } };
      return Promise.resolve();
    });
    renderFlow();

    await driveThroughAccountStep();

    expect(await screen.findByText('profile-next')).toBeInTheDocument();
    expect(screen.queryByText('preferences-complete')).toBeNull();
  });

  it('fresh signup (signed out) is unchanged: identity step follows account creation', async () => {
    renderFlow();

    await driveThroughAccountStep();

    expect(await screen.findByText('profile-next')).toBeInTheDocument();
    expect(screen.queryByText('preferences-complete')).toBeNull();
  });
});

// Issue #148: the verify call must carry the sit app hint — it selects the
// copy of the silent account-exists email (mirrors the study-side pin in
// TutorEnrollment.test.tsx).
describe('BabysitterEnrollment verify payload (issue #148)', () => {
  it("verifyEjmEmail is called with the sit app hint", async () => {
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    await vi.waitFor(() => {
      const call = h.calls.find((c) => c.name === 'verifyEjmEmail');
      expect(call).toBeTruthy();
      expect(call!.payload).toMatchObject({ app: 'sit' });
    });
  });
});

// Issue #250 round 5: the resend timer must follow the CONFIGURED
// verificationCodeCooldownS, not the code default -- the server answers
// cooldown repeats with a decoy success, so a shorter client timer
// re-enables a button that silently does nothing. This pins the page-level
// wiring (useClientConfigValue -> StepVerify prop); the timer behaviour
// itself is pinned in the shared-ui StepVerify suite.
describe('BabysitterEnrollment resend cooldown wiring (issue #250)', () => {
  it('passes the configured verificationCodeCooldownS to StepVerify', async () => {
    h.configValues = { verificationCodeCooldownS: 600 };
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('resend-cooldown-s')).toHaveTextContent(/^600$/);
    });
  });

  it('falls back to the code default when no override is stored', async () => {
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('resend-cooldown-s')).toHaveTextContent(/^60$/);
    });
  });
});
