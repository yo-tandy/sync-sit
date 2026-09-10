import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, render, cleanup, waitFor } from '@testing-library/react';

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
  // When set, enrollTutor rejects with this value (FunctionsError-shaped).
  error: null as unknown,
}));

vi.mock('@/config/firebase', () => ({ functions: {}, db: {}, auth: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    if (h.error) return Promise.reject(h.error);
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
import { StudentCrossAppWelcomePage } from '../StudentCrossAppWelcomePage';

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/tutor/welcome-crossapp']}>
        <Routes>
          <Route path="/tutor/welcome-crossapp" element={<StudentCrossAppWelcomePage />} />
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/signup" element={<div>signup page</div>} />
          <Route path="/tutor" element={<div>tutor portal</div>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

// COMPLETE root-only unified-flow identity (issue #435 milestone, PR4): no
// role profile at all — every field enrollTutor's crossApp mode derives is
// already on root, so there is nothing for the (reused) gap-detection to
// flag.
const rootOnlyDoc = {
  firstName: 'Iris',
  lastName: 'Martin',
  dateOfBirth: '2008-04-01',
  ejemEmail: 'iris28@ejm.org',
  classLevel: '2nde',
  gender: 'female',
  contactPhone: '+33600000002',
  profiles: {},
};

beforeEach(() => {
  cleanup();
  h.calls.length = 0;
  h.navigate = vi.fn();
  h.auth = { firebaseUser: { uid: 'u1' }, userDoc: rootOnlyDoc, loading: false };
  h.refreshUserDoc = vi.fn().mockImplementation(() => {
    h.auth.userDoc = { ...rootOnlyDoc, profiles: { tutor: {} } };
    return Promise.resolve();
  });
  h.error = null;
  i18n.changeLanguage('en');
});

describe('StudentCrossAppWelcomePage', () => {
  it('a sit babysitter (not this page\'s gate) is bounced to /signup', () => {
    h.auth.userDoc = {
      firstName: 'Sacha',
      profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'sacha@ejm.org' } },
    };
    renderPage();
    expect(screen.getByText('signup page')).toBeInTheDocument();
  });

  it('a doc with no verified identity at all is bounced to /signup', () => {
    h.auth.userDoc = { profiles: {} };
    renderPage();
    expect(screen.getByText('signup page')).toBeInTheDocument();
  });

  // The gate is NOT scoped to the unified flow's root-only shape — any
  // server-verified EJM identity with no study role (and no babysitter
  // profile) qualifies. A sync-do doer-only account is the concrete case
  // (decision 20 forbids sit/study reachability INTO do, not the reverse;
  // PR review discussion on #474).
  it('a doer-only account (verified identity, no sit/study role) renders the welcome continuation, not a redirect', () => {
    h.auth.userDoc = {
      firstName: 'Dana',
      lastName: 'Doer',
      dateOfBirth: '2008-04-01',
      ejemEmail: 'dana28@ejm.org',
      classLevel: '2nde',
      gender: 'other',
      contactPhone: '+33600000003',
      profiles: { doer: { enrollmentComplete: true } },
    };
    renderPage();
    expect(screen.queryByText('signup page')).toBeNull();
    expect(screen.getByText(i18n.t('welcomeCross.greeting', { name: 'Dana' }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('common.continue') })).toBeInTheDocument();
  });

  it('greets the root-only identity and offers Continue straight to subjects (no gaps)', () => {
    renderPage();
    expect(screen.getByText(i18n.t('welcomeCross.greeting', { name: 'Iris' }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('common.continue') })).toBeInTheDocument();
  });

  it('Continue -> subjects -> enrollTutor(crossApp:true, subjects) with no gap supplement, then /tutor', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));
    fireEvent.click(await screen.findByText('subjects-next'));

    await waitFor(() => {
      expect(h.navigate).toHaveBeenCalledWith('/tutor');
    });
    const call = h.calls.find((c) => c.name === 'enrollTutor');
    expect(call?.payload).toEqual({
      crossApp: true,
      subjects: [{ subject: 'math', levels: ['Terminale'], rate: 25 }],
      consentVersion: '2025-12-01',
    });
    expect(h.refreshUserDoc).toHaveBeenCalled();
  });

  it('surfaces a translated rejection on the subjects step without navigating', async () => {
    h.error = { code: 'functions/failed-precondition', details: { code: 'age/under-15' } };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));
    fireEvent.click(await screen.findByText('subjects-next'));

    const msg = i18n.t('enrollment.age.under15');
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(screen.queryByText('tutor portal')).toBeNull();
  });
});
