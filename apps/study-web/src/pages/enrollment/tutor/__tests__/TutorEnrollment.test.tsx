import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

// Hoisted shared state the mocks record into.
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  navigate: () => {},
  // Controllable authStore state — default is signed out so existing tests
  // keep their original (unauthenticated) behavior.
  auth: { firebaseUser: null as unknown, userDoc: null as unknown, loading: false },
  refreshUserDoc: () => Promise.resolve(),
  signIn: vi.fn(() => Promise.resolve()),
  // Controllable error reason so tests can drive the profile-exists notice.
  // Default null = plain-error behavior. There is no account-exists reason
  // anymore (issue #148: silent existing-account flow).
  errorReason: null as 'profile-exists' | null,
  // Controllable raw rejection (no machine-readable reason) so tests can
  // drive the plain-error fallback, e.g. the enroll-step already-exists
  // race backstop.
  rawError: null as { message: string } | null,
  // Controllable age-gate code so tests can drive the under-15 / mismatch
  // rejection branches. Default null = no age-gate rejection.
  ageCode: null as 'age/under-15' | 'age/mismatch' | null,
  // Controllable verifyEjmEmail rejection so tests can drive the send-cap
  // (issue #155 bypass allowance) branch. Default null = send succeeds.
  verifyError: null as { code: string; details: { reason: string } } | null,
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    // Model a backend rejection carrying the details.reason the SDK surfaces.
    if (name === 'enrollTutor' && h.errorReason) {
      return Promise.reject({ details: { reason: h.errorReason } });
    }
    // Model a reason-less rejection (e.g. the createUser race backstop):
    // the SDK surfaces an Error whose message is the HttpsError message.
    if (name === 'enrollTutor' && h.rawError) {
      return Promise.reject(new Error(h.rawError.message));
    }
    // Model the age-gate rejection: HttpsError('failed-precondition', msg,
    // { code }) reaches the client as FunctionsError with details.code.
    if (name === 'enrollTutor' && h.ageCode) {
      return Promise.reject({ code: 'functions/failed-precondition', details: { code: h.ageCode } });
    }
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
  signInWithEmailAndPassword: (...args: unknown[]) => h.signIn(...args),
}));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => h.navigate,
}));
vi.mock('@/stores/authStore', () => {
  const useAuthStore = (() => ({
    firebaseUser: h.auth.firebaseUser,
    userDoc: h.auth.userDoc,
    loading: h.auth.loading,
    refreshUserDoc: h.refreshUserDoc,
  })) as unknown as {
    (): unknown;
    getState: () => unknown;
    subscribe: (fn: (s: unknown) => void) => () => void;
  };
  // Statics used by the post-signup auto-login wait.
  useAuthStore.getState = () => ({ loading: false, firebaseUser: { uid: 'new' }, userDoc: h.auth.userDoc });
  useAuthStore.subscribe = () => () => {};
  return { useAuthStore, markNextSignInFresh: () => {} };
});
vi.mock('@ejm/shared-core', () => ({
  ADMIN_CONFIG_DEFS: {
    verificationCodeCooldownS: { default: 60, min: 60, max: 600, description: '' },
  },
}));
vi.mock('@ejm/study-core', () => ({
  getTutorProfile: (userDoc: { profiles?: { tutor?: unknown } } | null) =>
    userDoc?.profiles?.tutor ?? null,
}));

// Lightweight stand-ins for the child step components: each exposes a button
// that fires its callback so we can drive the orchestrator deterministically.
vi.mock('@ejm/shared-ui', () => ({
  // The app's adminConfigClient wrapper instantiates this at import time
  // (issue #250) -- stub returns the caller's fallback (code default).
  createAdminConfigReader: () => ({
    getClientConfigValue: (_k: string, fallback: number) => Promise.resolve(fallback),
    // The hook lives on the factory too (round-7 consolidation).
    useClientConfigValue: (_k: string, fallback: number) => fallback,
    __resetAdminConfigClientCacheForTests: () => {},
  }),
  // Mirrors the real helper: read details.reason off the rejected value.
  enrollmentErrorReason: (err: { details?: { reason?: unknown } } | null) => {
    const reason = err?.details?.reason;
    return reason === 'profile-exists' || reason === 'role-exclusive' || reason === 'send-cap'
      ? reason
      : null;
  },
  // Mirrors the real helper: read details.code off the rejected value.
  ageGateErrorCode: (err: { details?: { code?: unknown } } | null) => {
    const code = err?.details?.code;
    return code === 'age/under-15' || code === 'age/mismatch' ? code : null;
  },
  TopNav: ({ title }: { title: string }) => <div>{title}</div>,
  StepIndicator: ({ currentStep }: { currentStep: number }) => <div>step-{currentStep}</div>,
  StepEmail: ({ onChange, onSubmit, error }: {
    onChange: (e: string) => void;
    onSubmit: () => void;
    error?: string | null;
  }) => (
    <div>
      {error && <p>{error}</p>}
      <button
        onClick={() => {
          onChange('flow.tutor28@ejm.org');
          onSubmit();
        }}
      >
        email-submit
      </button>
    </div>
  ),
  StepVerify: ({ onVerify }: { onVerify: (c: string) => void }) => (
    <button onClick={() => onVerify('123456')}>verify-submit</button>
  ),
  StepPassword: (props: { onSubmit: (pw: string, c: string) => void; collectPassword?: boolean }) => (
    <button
      data-testid="step-password"
      data-collect={String(props.collectPassword)}
      onClick={() => props.onSubmit('Pw123456!', '2025-12-01')}
    >
      password-submit
    </button>
  ),
}));
vi.mock('@/components/ui/EnrollmentAppBar', () => ({
  EnrollmentAppBar: () => <div>enrollment-app-bar</div>,
}));
vi.mock('../StepSubjects', () => ({
  StepSubjects: ({ onNext, error }: { onNext: (d: unknown) => void; error?: string | null }) => (
    <div>
      {error && <p>{error}</p>}
      <button onClick={() => onNext([{ subject: 'math', levels: ['Terminale'], rate: 25 }])}>
        subjects-next
      </button>
    </div>
  ),
}));
vi.mock('../StepProfile', () => ({
  // Mirrors the real component's issue-#144 contract: when identityOnFile is
  // set, the identity fields are omitted from the payload. Profile is a plain
  // continue step (Subjects submits), so no loading/error props here.
  StepProfile: ({ onNext, identityOnFile }: {
    onNext: (d: unknown) => void;
    identityOnFile?: { firstName: string } | null;
  }) => (
    <div>
      {identityOnFile?.firstName && <p>identity-on-file:{identityOnFile.firstName}</p>}
      <button
        onClick={() =>
          onNext({
            ...(identityOnFile?.firstName
              ? {}
              : { firstName: 'Flow', lastName: 'Tutor', dateOfBirth: '2008-07-07' }),
            classLevel: 'Terminale',
            gender: 'other',
            contactEmail: 'flow@ejm.org',
          })
        }
      >
        profile-next
      </button>
    </div>
  ),
}));

import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { render } from '@testing-library/react';
import i18n from '@/i18n';
import { TutorEnrollment } from '../TutorEnrollment';

function renderFlow() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <TutorEnrollment />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  h.calls.length = 0;
  h.navigate = vi.fn();
  h.auth = { firebaseUser: null, userDoc: null, loading: false };
  h.refreshUserDoc = vi.fn().mockResolvedValue(undefined);
  h.signIn.mockClear();
  h.errorReason = null;
  h.rawError = null;
  h.ageCode = null;
  h.verifyError = null;
});

describe('TutorEnrollment orchestrator', () => {
  it('starts on the email step with the auth-phase chrome (TopNav + StepIndicator)', () => {
    renderFlow();
    expect(screen.getByText('email-submit')).toBeInTheDocument();
    expect(screen.getByText('step-0')).toBeInTheDocument();
    expect(screen.queryByText('enrollment-app-bar')).toBeNull();
  });

  it('drives through all steps and submits enrollTutor, then navigates to success', async () => {
    renderFlow();

    fireEvent.click(screen.getByText('email-submit'));
    expect(await screen.findByText('verify-submit')).toBeInTheDocument();
    expect(h.calls.map((c) => c.name)).toContain('verifyEjmEmail');

    fireEvent.click(screen.getByText('verify-submit'));
    expect(await screen.findByText('password-submit')).toBeInTheDocument();
    expect(h.calls.map((c) => c.name)).toContain('verifyCode');

    // Signed-out (default): password is collected.
    expect(screen.getByTestId('step-password')).toHaveAttribute('data-collect', 'true');

    // Step 2 -> 3 crosses into the post-auth phase: app bar replaces TopNav.
    // Base information about the tutor comes FIRST (issue #143 as clarified);
    // subjects/levels/rate follow it, and the dropped prefs never appear.
    fireEvent.click(screen.getByText('password-submit'));
    expect(await screen.findByText('profile-next')).toBeInTheDocument();
    expect(screen.queryByText('subjects-next')).toBeNull();
    expect(screen.getByText('enrollment-app-bar')).toBeInTheDocument();
    expect(screen.queryByText(/step-\d/)).toBeNull();

    fireEvent.click(screen.getByText('profile-next'));
    fireEvent.click(await screen.findByText('subjects-next'));

    // enrollTutor called with the composed payload; success navigation fired.
    const enroll = await vi.waitFor(() => {
      const c = h.calls.find((x) => x.name === 'enrollTutor');
      expect(c).toBeTruthy();
      return c!;
    });
    const payload = enroll.payload as { ejemEmail: string; verificationCode: string; password: string; enrollment: Record<string, unknown> };
    expect(payload.verificationCode).toBe('123456');
    expect(payload.password).toBe('Pw123456!');
    expect(payload.enrollment).toMatchObject({
      firstName: 'Flow', classLevel: 'Terminale',
      subjects: [{ subject: 'math', levels: ['Terminale'], rate: 25 }],
      contactEmail: 'flow@ejm.org',
    });
    // The dropped pref fields must be ABSENT from the payload (not sent as
    // empty values) — the server defaults are the single source of truth.
    for (const key of ['sessionLengthsMin', 'locationPrefs', 'paddingMin', 'areaMode', 'arrondissements', 'areaAddress', 'areaLatLng', 'areaRadiusKm', 'aboutMe']) {
      expect(payload.enrollment).not.toHaveProperty(key);
    }
    await vi.waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith('/enroll/tutor/success', { state: { firstName: 'Flow' } }),
    );
    // New-account path signs the tutor in — the success CTA must land in
    // the portal, not bounce to login.
    expect(h.signIn).toHaveBeenCalledWith(expect.anything(), 'flow.tutor28@ejm.org', 'Pw123456!');
  });

  it('a sign-in failure after successful enrollment still reaches the success page', async () => {
    // Enrollment fully succeeded (account/doc/schedule written, code doc
    // consumed) — an auth hiccup must not read as an enrollment error or
    // strand the user mid-wizard.
    h.signIn.mockRejectedValueOnce(new Error('auth/network-request-failed'));
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    fireEvent.click(await screen.findByText('verify-submit'));
    fireEvent.click(await screen.findByText('password-submit'));
    fireEvent.click(await screen.findByText('profile-next'));
    fireEvent.click(await screen.findByText('subjects-next'));

    await vi.waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith('/enroll/tutor/success', { state: { firstName: 'Flow' } }),
    );
    expect(screen.queryByText(/network-request-failed/)).toBeNull();
  });

  it('authed without a tutor profile: consent-only StepPassword, enrollTutor omits password, refreshes doc', async () => {
    h.auth = { firebaseUser: { uid: 'p1' }, userDoc: { profiles: { parent: {} } }, loading: false };
    // Model the real store: refreshUserDoc pulls the freshly-added tutor profile.
    // The redirect effect must NOT hijack the success navigation once this lands.
    h.refreshUserDoc = vi.fn().mockImplementation(() => {
      h.auth.userDoc = { profiles: { parent: {}, tutor: {} } };
      return Promise.resolve();
    });
    renderFlow();

    fireEvent.click(screen.getByText('email-submit'));
    fireEvent.click(await screen.findByText('verify-submit'));

    const passwordStep = await screen.findByTestId('step-password');
    expect(passwordStep).toHaveAttribute('data-collect', 'false');

    fireEvent.click(passwordStep);
    fireEvent.click(await screen.findByText('profile-next'));
    fireEvent.click(await screen.findByText('subjects-next'));

    const enroll = await vi.waitFor(() => {
      const c = h.calls.find((x) => x.name === 'enrollTutor');
      expect(c).toBeTruthy();
      return c!;
    });
    const payload = enroll.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('password');
    // Already signed in — no re-authentication.
    expect(h.signIn).not.toHaveBeenCalled();
    // refreshUserDoc must be awaited before the success navigation.
    await vi.waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith('/enroll/tutor/success', { state: { firstName: 'Flow' } }),
    );
    expect(h.refreshUserDoc).toHaveBeenCalled();
    // The now-present tutor profile must not divert the success navigation home.
    expect(h.navigate).not.toHaveBeenCalledWith('/', { replace: true });
  });

  it('add-profile with identity on file: summary shown, payload omits identity, success uses the doc name (issue #144)', async () => {
    h.auth = {
      firebaseUser: { uid: 'x1' },
      userDoc: {
        firstName: 'Iris', lastName: 'Martin', dateOfBirth: '2008-01-15',
        profiles: { babysitter: {} },
      },
      loading: false,
    };
    renderFlow();

    fireEvent.click(screen.getByText('email-submit'));
    fireEvent.click(await screen.findByText('verify-submit'));
    fireEvent.click(await screen.findByTestId('step-password'));

    // StepProfile (now first) received the on-file identity.
    expect(await screen.findByText('identity-on-file:Iris')).toBeInTheDocument();
    fireEvent.click(screen.getByText('profile-next'));
    fireEvent.click(await screen.findByText('subjects-next'));

    const enroll = await vi.waitFor(() => {
      const c = h.calls.find((x) => x.name === 'enrollTutor');
      expect(c).toBeTruthy();
      return c!;
    });
    const payload = enroll.payload as { enrollment: Record<string, unknown> };
    // The identity keys are ABSENT (not sent as null/empty) — the server
    // keeps the stored, set-once values.
    for (const key of ['firstName', 'lastName', 'dateOfBirth']) {
      expect(payload.enrollment).not.toHaveProperty(key);
    }
    expect(payload.enrollment).toMatchObject({ classLevel: 'Terminale' });
    await vi.waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith('/enroll/tutor/success', { state: { firstName: 'Iris' } }),
    );
  });

  it('authed WITH a tutor profile: redirects home instead of enrolling', () => {
    h.auth = { firebaseUser: { uid: 'p1' }, userDoc: { profiles: { tutor: {} } }, loading: false };
    renderFlow();
    expect(h.navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  async function driveToEnrollTutor() {
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    fireEvent.click(await screen.findByText('verify-submit'));
    fireEvent.click(await screen.findByText('password-submit'));
    fireEvent.click(await screen.findByText('profile-next'));
    fireEvent.click(await screen.findByText('subjects-next'));
    await vi.waitFor(() => expect(h.calls.some((c) => c.name === 'enrollTutor')).toBe(true));
  }

  it('verifyEjmEmail is called with the study app hint (silent account-exists copy)', async () => {
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    await vi.waitFor(() => {
      const call = h.calls.find((c) => c.name === 'verifyEjmEmail');
      expect(call).toBeTruthy();
      // The stub StepEmail fires onChange+onSubmit in the same tick, so the
      // email state is still the initial '' in this render — the pin here is
      // the app hint, not the email value.
      expect(call!.payload).toMatchObject({ app: 'study' });
    });
  });

  it('a reason-less enrollTutor rejection (race backstop) shows the plain message, never a login CTA', async () => {
    // Issue #148: the account-exists CTA is gone — an existing account no
    // longer produces any special client branch. The only remaining
    // already-exists surface is the createUser race backstop, which arrives
    // reason-less and renders as a plain error string.
    h.rawError = { message: 'An account with this email already exists' };
    await driveToEnrollTutor();

    expect(await screen.findByText('An account with this email already exists')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: i18n.t('auth.login') })).toBeNull();
    // No success navigation on failure.
    expect(h.navigate).not.toHaveBeenCalledWith('/enroll/tutor/success', expect.anything());
  });

  it("verifyEjmEmail 'send-cap' rejection (issue #155 bypass allowance) renders the translated copy and stays on the email step", async () => {
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

  it("enrollTutor 'profile-exists' rejection renders alreadyEnrolled and NO login link", async () => {
    h.errorReason = 'profile-exists';
    await driveToEnrollTutor();

    const msg = i18n.t('enrollment.alreadyEnrolled');
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: i18n.t('auth.login') })).toBeNull();
  });

  it("enrollTutor 'age/under-15' rejection renders the parental-enrollment message", async () => {
    h.ageCode = 'age/under-15';
    await driveToEnrollTutor();

    const msg = i18n.t('enrollment.age.under15');
    expect(await screen.findByText(msg)).toBeInTheDocument();
    // Distinct from the mismatch message and from the login CTA.
    expect(screen.queryByText(i18n.t('enrollment.age.mismatch'))).toBeNull();
    expect(screen.queryByRole('link', { name: i18n.t('auth.login') })).toBeNull();
    expect(h.navigate).not.toHaveBeenCalledWith('/enroll/tutor/success', expect.anything());
  });

  it("enrollTutor 'age/mismatch' rejection renders the contact-admin message", async () => {
    h.ageCode = 'age/mismatch';
    await driveToEnrollTutor();

    const msg = i18n.t('enrollment.age.mismatch');
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('enrollment.age.under15'))).toBeNull();
    expect(h.navigate).not.toHaveBeenCalledWith('/enroll/tutor/success', expect.anything());
  });
});
