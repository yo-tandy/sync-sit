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
}));

vi.mock('@/config/firebase', () => ({ auth: {}, functions: {}, db: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
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
  };
});
vi.mock('@ejm/sit-core', () => ({
  getBabysitterProfile: (userDoc: { profiles?: { babysitter?: unknown } } | null) =>
    userDoc?.profiles?.babysitter ?? null,
}));

// Lightweight stand-ins for the child step components.
vi.mock('@ejm/shared-ui', () => ({
  enrollmentErrorReason: () => null,
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
  i18n.changeLanguage('en');
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
