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
  // When set, enrollBabysitter rejects with this details.reason.
  errorReason: null as string | null,
}));

vi.mock('@/config/firebase', () => ({ functions: {}, db: {}, auth: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    if (h.errorReason) return Promise.reject({ details: { reason: h.errorReason } });
    return Promise.resolve({ data: { success: true, uid: 'u1' } });
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

import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Routes, Route } from 'react-router';
import i18n from '@/i18n';
import { CrossAppWelcomePage } from '../CrossAppWelcomePage';

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/welcome-sit']}>
        <Routes>
          <Route path="/welcome-sit" element={<CrossAppWelcomePage />} />
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/signup" element={<div>signup page</div>} />
          <Route path="/babysitter" element={<div>babysitter portal</div>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const tutorDoc = {
  firstName: 'Iris',
  lastName: 'Martin',
  profiles: { tutor: { enrollmentComplete: true, ejemEmail: 'iris@ejm.org' } },
};

beforeEach(() => {
  cleanup();
  h.calls.length = 0;
  h.navigate = vi.fn();
  h.auth = { firebaseUser: { uid: 't1' }, userDoc: tutorDoc, loading: false };
  h.refreshUserDoc = vi.fn().mockResolvedValue(undefined);
  h.errorReason = null;
  i18n.changeLanguage('en');
});

describe('CrossAppWelcomePage (sit)', () => {
  it('shows the app branding and a back-to-origin cancel (terms are opt-out-able)', () => {
    renderPage();
    expect(screen.getByAltText('Sync/Sit')).toBeInTheDocument();
    const back = screen.getByRole('link', { name: /back to sync\/study/i });
    expect(back).toHaveAttribute('href', expect.stringContaining('http'));
  });

  it('greets by first name and states the cross-app offer with a consent line', () => {
    renderPage();
    expect(screen.getByText(i18n.t('welcomeCross.greeting', { name: 'Iris' }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('welcomeCross.body'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('enrollment.termsOfService'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('enrollment.privacyPolicy'))).toBeInTheDocument();
  });

  it('Continue calls enrollBabysitter in crossApp mode — NO email, code, or password keys', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));

    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/enroll/babysitter'));
    const call = h.calls.find((c) => c.name === 'enrollBabysitter')!;
    expect(call).toBeTruthy();
    const payload = call.payload as Record<string, unknown>;
    expect(payload.crossApp).toBe(true);
    expect(typeof payload.consentVersion).toBe('string');
    for (const key of ['ejemEmail', 'verificationCode', 'password']) {
      expect(payload).not.toHaveProperty(key);
    }
    expect(h.refreshUserDoc).toHaveBeenCalled();
  });

  it('profile-exists rejection routes to the babysitter portal instead of erroring', async () => {
    h.errorReason = 'profile-exists';
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));

    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/babysitter'));
  });

  it('signed-out visitors are sent to /login', () => {
    h.auth = { firebaseUser: null, userDoc: null, loading: false };
    renderPage();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('an existing babysitter is redirected to their portal', () => {
    h.auth = {
      firebaseUser: { uid: 'b1' },
      userDoc: { firstName: 'B', profiles: { babysitter: { enrollmentComplete: true } } },
      loading: false,
    };
    renderPage();
    expect(screen.getByText('babysitter portal')).toBeInTheDocument();
  });

  it('a signed-in user with NO tutor profile falls back to /signup', () => {
    h.auth = { firebaseUser: { uid: 'x1' }, userDoc: { profiles: {} }, loading: false };
    renderPage();
    expect(screen.getByText('signup page')).toBeInTheDocument();
  });
});
