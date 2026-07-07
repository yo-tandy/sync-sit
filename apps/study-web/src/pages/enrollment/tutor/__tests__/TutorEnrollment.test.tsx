import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';

// Hoisted shared state the mocks record into.
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  navigate: (..._a: unknown[]) => {},
  // Controllable authStore state — default is signed out so existing tests
  // keep their original (unauthenticated) behavior.
  auth: { firebaseUser: null as unknown, userDoc: null as unknown, loading: false },
  refreshUserDoc: (..._a: unknown[]) => Promise.resolve(),
  // Controllable error reason so tests can drive the account-exists /
  // profile-exists CTAs. Default null = plain-error behavior.
  errorReason: null as 'account-exists' | 'profile-exists' | null,
}));

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    // Model a backend rejection carrying the details.reason the SDK surfaces.
    if (name === 'enrollTutor' && h.errorReason) {
      return Promise.reject({ details: { reason: h.errorReason } });
    }
    return Promise.resolve({ data: { uid: 'u1' } });
  },
}));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => h.navigate,
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    firebaseUser: h.auth.firebaseUser,
    userDoc: h.auth.userDoc,
    loading: h.auth.loading,
    refreshUserDoc: h.refreshUserDoc,
  }),
}));
vi.mock('@ejm/study-core', () => ({
  getTutorProfile: (userDoc: { profiles?: { tutor?: unknown } } | null) =>
    userDoc?.profiles?.tutor ?? null,
}));

// Lightweight stand-ins for the child step components: each exposes a button
// that fires its callback so we can drive the orchestrator deterministically.
vi.mock('@ejm/shared-ui', () => ({
  // Mirrors the real helper: read details.reason off the rejected value.
  enrollmentErrorReason: (err: { details?: { reason?: unknown } } | null) => {
    const reason = err?.details?.reason;
    return reason === 'account-exists' || reason === 'profile-exists' ? reason : null;
  },
  TopNav: ({ title }: { title: string }) => <div>{title}</div>,
  StepIndicator: ({ currentStep }: { currentStep: number }) => <div>step-{currentStep}</div>,
  StepEmail: ({ onSubmit }: { onSubmit: () => void }) => (
    <button onClick={onSubmit}>email-submit</button>
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
vi.mock('../StepProfile', () => ({
  StepProfile: ({ onNext }: { onNext: (d: unknown) => void }) => (
    <button onClick={() => onNext({ firstName: 'Flow', lastName: 'Tutor', dateOfBirth: '2008-07-07', classLevel: 'Terminale', gender: 'other' })}>
      profile-next
    </button>
  ),
}));
vi.mock('../StepPrefs', () => ({
  StepPrefs: ({ onNext, error }: { onNext: (d: unknown) => void; error: string | null }) => (
    <div>
      {error && <p>{error}</p>}
      <button onClick={() => onNext({ sessionLengthsMin: [60], locationPrefs: ['online'], paddingMin: 0, contactEmail: 'flow@ejm.org', areaMode: 'arrondissement' })}>
        prefs-next
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
  h.errorReason = null;
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
    fireEvent.click(screen.getByText('password-submit'));
    expect(await screen.findByText('profile-next')).toBeInTheDocument();
    expect(screen.getByText('enrollment-app-bar')).toBeInTheDocument();
    expect(screen.queryByText(/step-\d/)).toBeNull();

    fireEvent.click(screen.getByText('profile-next'));
    fireEvent.click(await screen.findByText('prefs-next'));

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
      sessionLengthsMin: [60], locationPrefs: ['online'], contactEmail: 'flow@ejm.org',
    });
    expect(h.navigate).toHaveBeenCalledWith('/enroll/tutor/success', { state: { firstName: 'Flow' } });
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
    fireEvent.click(await screen.findByText('prefs-next'));

    const enroll = await vi.waitFor(() => {
      const c = h.calls.find((x) => x.name === 'enrollTutor');
      expect(c).toBeTruthy();
      return c!;
    });
    const payload = enroll.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('password');
    // refreshUserDoc must be awaited before the success navigation.
    await vi.waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith('/enroll/tutor/success', { state: { firstName: 'Flow' } }),
    );
    expect(h.refreshUserDoc).toHaveBeenCalled();
    // The now-present tutor profile must not divert the success navigation home.
    expect(h.navigate).not.toHaveBeenCalledWith('/', { replace: true });
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
    fireEvent.click(await screen.findByText('prefs-next'));
    await vi.waitFor(() => expect(h.calls.some((c) => c.name === 'enrollTutor')).toBe(true));
  }

  it("enrollTutor 'account-exists' rejection renders the login CTA + a /login link", async () => {
    h.errorReason = 'account-exists';
    await driveToEnrollTutor();

    const cta = i18n.t('enrollment.accountExistsCta');
    expect(await screen.findByText(cta)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: i18n.t('auth.login') });
    expect(link).toHaveAttribute('href', '/login');
    // No success navigation on failure.
    expect(h.navigate).not.toHaveBeenCalledWith('/enroll/tutor/success', expect.anything());
  });

  it("enrollTutor 'profile-exists' rejection renders alreadyEnrolled and NO login link", async () => {
    h.errorReason = 'profile-exists';
    await driveToEnrollTutor();

    const msg = i18n.t('enrollment.alreadyEnrolled');
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: i18n.t('auth.login') })).toBeNull();
  });
});
