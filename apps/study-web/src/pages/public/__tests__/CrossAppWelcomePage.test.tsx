import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, render, cleanup } from '@testing-library/react';

// Hoisted recorders for the callable and auth state.
const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  navigate: () => {},
  auth: {
    firebaseUser: null as unknown,
    userDoc: null as Record<string, unknown> | null,
    loading: false,
  },
  refreshUserDoc: () => Promise.resolve(),
  errorReason: null as string | null,
}));

vi.mock('@/config/firebase', () => ({ functions: {}, db: {}, auth: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    if (h.errorReason) return Promise.reject({ details: { reason: h.errorReason } });
    return Promise.resolve({ data: { uid: 'u1' } });
  },
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
// StepSubjects is reused as-is — stub it to drive the submit deterministically.
vi.mock('@/pages/enrollment/tutor/StepSubjects', () => ({
  StepSubjects: ({ onNext, error }: { onNext: (s: unknown) => void; error?: string | null }) => (
    <div>
      {error && <p>{error}</p>}
      <button onClick={() => onNext([{ subject: 'math', levels: ['Terminale'], rate: 25 }])}>
        subjects-next
      </button>
    </div>
  ),
}));

import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Routes, Route } from 'react-router';
import i18n from '@/i18n';
import { CrossAppWelcomePage } from '../CrossAppWelcomePage';

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/welcome-study']}>
        <Routes>
          <Route path="/welcome-study" element={<CrossAppWelcomePage />} />
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/signup" element={<div>signup page</div>} />
          <Route path="/tutor" element={<div>tutor portal</div>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const babysitterDoc = {
  firstName: 'Sacha',
  lastName: 'Sitter',
  profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'sacha@ejm.org' } },
};

beforeEach(() => {
  cleanup();
  h.calls.length = 0;
  h.navigate = vi.fn();
  h.auth = { firebaseUser: { uid: 'b1' }, userDoc: babysitterDoc, loading: false };
  h.refreshUserDoc = vi.fn().mockResolvedValue(undefined);
  h.errorReason = null;
  i18n.changeLanguage('en');
});

describe('CrossAppWelcomePage (study)', () => {
  it('greets by first name with the cross-app offer and a consent line; subjects hidden until Continue', () => {
    renderPage();
    expect(screen.getByText(i18n.t('welcomeCross.greeting', { name: 'Sacha' }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('welcomeCross.body'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('enrollment.termsOfService'))).toBeInTheDocument();
    expect(screen.queryByText('subjects-next')).toBeNull();
  });

  it('Continue reveals StepSubjects; submit calls enrollTutor in crossApp mode with subjects ONLY', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));
    fireEvent.click(screen.getByText('subjects-next'));

    await vi.waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith('/enroll/tutor/success', {
        state: { firstName: 'Sacha' },
      }),
    );
    const call = h.calls.find((c) => c.name === 'enrollTutor')!;
    expect(call).toBeTruthy();
    const payload = call.payload as Record<string, unknown>;
    expect(payload.crossApp).toBe(true);
    expect(payload.subjects).toEqual([{ subject: 'math', levels: ['Terminale'], rate: 25 }]);
    expect(typeof payload.consentVersion).toBe('string');
    for (const key of ['ejemEmail', 'verificationCode', 'password', 'enrollment']) {
      expect(payload).not.toHaveProperty(key);
    }
    expect(h.refreshUserDoc).toHaveBeenCalled();
  });

  it('profile-exists rejection routes to the tutor portal instead of erroring', async () => {
    h.errorReason = 'profile-exists';
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));
    fireEvent.click(screen.getByText('subjects-next'));

    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/tutor'));
  });

  it('signed-out visitors are sent to /login', () => {
    h.auth = { firebaseUser: null, userDoc: null, loading: false };
    renderPage();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('an existing tutor is redirected to their portal', () => {
    h.auth = {
      firebaseUser: { uid: 't1' },
      userDoc: { firstName: 'T', profiles: { tutor: { enrollmentComplete: true } } },
      loading: false,
    };
    renderPage();
    expect(screen.getByText('tutor portal')).toBeInTheDocument();
  });

  it('a signed-in user with NO babysitter profile falls back to /signup', () => {
    h.auth = { firebaseUser: { uid: 'x1' }, userDoc: { profiles: {} }, loading: false };
    renderPage();
    expect(screen.getByText('signup page')).toBeInTheDocument();
  });
});
