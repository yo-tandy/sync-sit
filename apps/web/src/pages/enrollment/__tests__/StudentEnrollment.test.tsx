import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, render, cleanup, waitFor } from '@testing-library/react';

// Hoisted shared state the mocks record into (mirrors BabysitterEnrollment.test.tsx).
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  navigate: vi.fn(),
  auth: {
    firebaseUser: null as unknown,
    userDoc: null as Record<string, unknown> | null,
    loading: false,
  },
  refreshUserDoc: () => Promise.resolve(),
  enrollError: null as unknown,
  verifyError: null as unknown,
}));

vi.mock('@/config/firebase', () => ({ auth: {}, functions: {}, db: {}, storage: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    if (name === 'verifyEjmEmail' && h.verifyError) {
      return Promise.reject(h.verifyError);
    }
    if (name === 'enrollStudentIdentity' && h.enrollError) {
      return Promise.reject(h.enrollError);
    }
    return Promise.resolve({ data: { uid: 'u1' } });
  },
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(() => {
    // Root-only identity — no role profile at all (issue #435 PR4 shape).
    h.auth = {
      firebaseUser: { uid: 'u1' },
      userDoc: { profiles: {}, ejemEmail: 'iris28@ejm.org' },
      loading: false,
    };
    return Promise.resolve();
  }),
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  updateDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: () => 'server-ts',
}));
vi.mock('firebase/storage', () => ({
  ref: () => ({}),
  uploadBytes: vi.fn(() => Promise.resolve()),
  getDownloadURL: vi.fn(() => Promise.resolve('https://example.com/photo.jpg')),
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
  getSitRole: (userDoc: { profiles?: { babysitter?: unknown; parent?: unknown }; isAdmin?: boolean } | null) => {
    if (userDoc?.profiles?.babysitter) return 'babysitter';
    if (userDoc?.profiles?.parent) return 'parent';
    if (userDoc?.isAdmin) return 'admin';
    return undefined;
  },
}));

vi.mock('@ejm/shared-ui', async () => ({
  // The real error-key mapping: the page's error copy is what these tests pin.
  ...(await vi.importActual<typeof import('../../../../../../packages/shared-ui/src/enrollment/errorKeys')>('../../../../../../packages/shared-ui/src/enrollment/errorKeys')),
  // Layout-only column (issue #528): pass children through.
  AuthColumn: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  createAdminConfigReader: () => ({
    getClientConfigValue: (_k: string, fallback: number) => Promise.resolve(fallback),
    useClientConfigValue: (_k: string, fallback: number) => fallback,
    __resetAdminConfigClientCacheForTests: () => {},
  }),
  enrollmentErrorReason: (err: { details?: { reason?: unknown } } | null) => {
    const reason = err?.details?.reason;
    return reason === 'profile-exists' || reason === 'role-exclusive' || reason === 'send-cap'
      ? reason
      : null;
  },
  ageGateErrorCode: (err: { details?: { code?: unknown } } | null) => {
    const code = err?.details?.code;
    return code === 'age/under-15' || code === 'age/mismatch' ? code : null;
  },
  StepEmail: ({ onSubmit, error }: { onSubmit: () => void; error?: string | null }) => (
    <div>
      {error && <p>{error}</p>}
      <button onClick={onSubmit}>email-submit</button>
    </div>
  ),
  StepVerify: ({ onVerify }: { onVerify: (c: string) => void }) => (
    <button onClick={() => onVerify('123456')}>verify-submit</button>
  ),
  StepPassword: (props: { onSubmit: (pw: string, c: string) => void }) => (
    <button onClick={() => props.onSubmit('Pw123456!', '1.0')}>password-submit</button>
  ),
  StepBasicInfo: ({ onNext }: { onNext: (d: unknown) => void }) => (
    <button
      onClick={() =>
        onNext({ firstName: 'Iris', lastName: 'Martin', dateOfBirth: '2008-01-15', classLevel: 'Terminale', gender: 'female' })
      }
    >
      basic-info-next
    </button>
  ),
  StepContactInfo: ({ onNext }: { onNext: (d: unknown) => void }) => (
    <button
      onClick={() =>
        onNext({ contactEmail: 'iris@example.com', contactPhone: '', whatsapp: null, contactVisibilityConsent: true })
      }
    >
      contact-info-next
    </button>
  ),
  StepAdditionalInfo: ({ onNext, serverError }: { onNext: (d: unknown) => void; serverError?: string | null }) => (
    <div>
      {serverError && <p>{serverError}</p>}
      <button onClick={() => onNext({ bio: 'Hi!', photoFile: null, address: null })}>additional-info-next</button>
    </div>
  ),
}));
vi.mock('@/components/ui', () => ({
  TopNav: ({ title, onBack }: { title: string; onBack?: () => void }) => (
    <div>
      {title}
      {onBack && <button onClick={onBack}>back</button>}
    </div>
  ),
  StepIndicator: ({ currentStep }: { currentStep: number }) => <div>step-{currentStep}</div>,
}));

import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import i18n from '@/i18n';
import { StudentEnrollment } from '../StudentEnrollment';

function renderFlow() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <StudentEnrollment />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

async function driveToAccountCreation() {
  fireEvent.click(screen.getByText('email-submit'));
  fireEvent.click(await screen.findByText('verify-submit'));
  fireEvent.click(await screen.findByText('password-submit'));
  fireEvent.click(await screen.findByText('basic-info-next'));
  fireEvent.click(await screen.findByText('contact-info-next'));
  fireEvent.click(await screen.findByText('additional-info-next'));
}

beforeEach(() => {
  cleanup();
  h.calls.length = 0;
  h.navigate = vi.fn();
  h.auth = { firebaseUser: null, userDoc: null, loading: false };
  h.refreshUserDoc = () => Promise.resolve();
  h.enrollError = null;
  h.verifyError = null;
});

describe('StudentEnrollment unexpected send-code failure', () => {
  it("an 'internal' rejection renders the translated server-error copy, never the bare token", async () => {
    // What the client SDK hands back for an uncaught server throw: a
    // FunctionsError whose message is literally 'internal'.
    h.verifyError = Object.assign(new Error('internal'), { code: 'functions/internal' });
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));

    expect(await screen.findByText(i18n.t('enrollment.serverError'))).toBeInTheDocument();
    expect(screen.queryByText('internal')).toBeNull();
    expect(screen.queryByText('verify-submit')).toBeNull();
  });
});

describe('StudentEnrollment step order and back-navigation', () => {
  it('walks email -> verify -> password -> basicInfo -> contactInfo -> additionalInfo in order', async () => {
    renderFlow();
    expect(screen.getByText('email-submit')).toBeInTheDocument();

    fireEvent.click(screen.getByText('email-submit'));
    expect(await screen.findByText('verify-submit')).toBeInTheDocument();

    fireEvent.click(screen.getByText('verify-submit'));
    expect(await screen.findByText('password-submit')).toBeInTheDocument();

    fireEvent.click(screen.getByText('password-submit'));
    expect(await screen.findByText('basic-info-next')).toBeInTheDocument();

    fireEvent.click(screen.getByText('basic-info-next'));
    expect(await screen.findByText('contact-info-next')).toBeInTheDocument();

    fireEvent.click(screen.getByText('contact-info-next'));
    expect(await screen.findByText('additional-info-next')).toBeInTheDocument();
  });

  it('back-navigation from a later step returns to the previous one', async () => {
    renderFlow();
    fireEvent.click(screen.getByText('email-submit'));
    await screen.findByText('verify-submit');
    fireEvent.click(screen.getByText('verify-submit'));
    await screen.findByText('password-submit');
    fireEvent.click(screen.getByText('password-submit'));
    await screen.findByText('basic-info-next');
    expect(screen.getByText('step-3')).toBeInTheDocument();

    fireEvent.click(screen.getByText('back'));
    expect(await screen.findByText('password-submit')).toBeInTheDocument();
    expect(screen.getByText('step-2')).toBeInTheDocument();
    expect(screen.queryByText('basic-info-next')).toBeNull();
  });
});

describe('StudentEnrollment account creation', () => {
  it('calls enrollStudentIdentity exactly once with the assembled payload, then navigates to /enroll/choose-app', async () => {
    renderFlow();
    await driveToAccountCreation();

    await waitFor(() => {
      expect(h.navigate).toHaveBeenCalledWith('/enroll/choose-app');
    });

    const enrollCalls = h.calls.filter((c) => c.name === 'enrollStudentIdentity');
    expect(enrollCalls).toHaveLength(1);
    expect(enrollCalls[0].payload).toMatchObject({
      ejemEmail: '',
      verificationCode: '123456',
      password: 'Pw123456!',
      consentVersion: '1.0',
      firstName: 'Iris',
      lastName: 'Martin',
      dateOfBirth: '2008-01-15',
      classLevel: 'Terminale',
      gender: 'female',
      contactEmail: 'iris@example.com',
      contactVisibilityConsent: true,
      bio: 'Hi!',
      address: null,
    });
  });

  it('surfaces a translated age-gate rejection without navigating away', async () => {
    h.enrollError = { code: 'functions/failed-precondition', details: { code: 'age/under-15' } };
    renderFlow();
    await driveToAccountCreation();

    const msg = i18n.t('enrollment.age.under15');
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalledWith('/enroll/choose-app');
  });
});

// The final-step catch used to render err.message: an unexpected fault showed
// the bare token 'internal', and deliberate server messages were English-only.
describe('StudentEnrollment account-creation error copy', () => {
  it.each([
    ['internal', 'internal', 'enrollment.serverError'],
    // The createUser race backstop: stays generic, never account-exists copy (#148).
    ['already-exists', 'An account with this email already exists', 'enrollment.serverError'],
    ['invalid-argument', 'Invalid enrollment data', 'enrollment.submitInvalid'],
    ['deadline-exceeded', 'Verification code has expired. Please request a new one.', 'auth.codeExpired'],
  ])('a %s rejection renders translated copy, never the server text', async (code, message, key) => {
    h.enrollError = Object.assign(new Error(message), { code: `functions/${code}` });
    renderFlow();
    await driveToAccountCreation();

    expect(await screen.findByText(i18n.t(key))).toBeInTheDocument();
    expect(screen.queryByText(message)).toBeNull();
    expect(h.navigate).not.toHaveBeenCalledWith('/enroll/choose-app');
  });
});
