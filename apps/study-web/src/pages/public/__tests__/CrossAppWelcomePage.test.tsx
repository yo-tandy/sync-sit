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

// COMPLETE sit doc: no gaps, so the one-tap flow is welcome -> subjects only.
const babysitterDoc = {
  firstName: 'Sacha',
  lastName: 'Sitter',
  dateOfBirth: '2008-04-01',
  profiles: {
    babysitter: {
      enrollmentComplete: true,
      ejemEmail: 'sacha@ejm.org',
      classLevel: '2nde',
      gender: null,
      contactPhone: '+33600000002',
    },
  },
};
// Contact skipped in sit (issue #203): the details phase collects just that.
const babysitterNoContactDoc = {
  ...babysitterDoc,
  profiles: {
    babysitter: {
      enrollmentComplete: true,
      ejemEmail: 'sacha@ejm.org',
      classLevel: '2nde',
      gender: null,
    },
  },
};
// Degenerate doc: only the verified EJM identity — every gap present.
const babysitterBareDoc = {
  profiles: { babysitter: { enrollmentComplete: false, ejemEmail: 'sacha@ejm.org' } },
};

beforeEach(() => {
  cleanup();
  h.calls.length = 0;
  h.navigate = vi.fn();
  h.auth = { firebaseUser: { uid: 'b1' }, userDoc: babysitterDoc, loading: false };
  h.refreshUserDoc = vi.fn().mockResolvedValue(undefined);
  h.error = null;
  i18n.changeLanguage('en');
});

describe('CrossAppWelcomePage (study)', () => {
  it('shows the app branding and a back-to-origin cancel (terms are opt-out-able)', () => {
    renderPage();
    expect(screen.getByAltText('Sync/Study')).toBeInTheDocument();
    const back = screen.getByRole('link', { name: /back to sync\/sit/i });
    expect(back).toHaveAttribute('href', expect.stringContaining('http'));
  });

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
      expect(h.navigate).toHaveBeenCalledWith('/tutor'),
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

  // ── Issue #203: the details phase collects exactly the sit profile's gaps ──

  it('a contactless sit profile gets a details phase with ONLY the contact inputs', () => {
    h.auth = { firebaseUser: { uid: 'b1' }, userDoc: babysitterNoContactDoc, loading: false };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));

    // Contact inputs render; nothing already on file is re-asked.
    expect(screen.getByLabelText(i18n.t('enrollment.contactEmail'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('enrollment.contactPhone'))).toBeInTheDocument();
    expect(screen.queryByLabelText(i18n.t('enrollment.dateOfBirth'))).toBeNull();
    expect(screen.queryByLabelText(i18n.t('enrollment.classLabel'))).toBeNull();
    expect(screen.queryByText(i18n.t('enrollment.gender'))).toBeNull();
    expect(screen.queryByLabelText(i18n.t('enrollment.firstName'))).toBeNull();
    // Subjects not shown yet.
    expect(screen.queryByText('subjects-next')).toBeNull();
  });

  it('the details continue stays disabled until a contact field is entered, then the supplement rides the payload', async () => {
    h.auth = { firebaseUser: { uid: 'b1' }, userDoc: babysitterNoContactDoc, loading: false };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));

    const detailsContinue = screen.getByRole('button', { name: i18n.t('common.continue') });
    expect(detailsContinue).toBeDisabled();
    fireEvent.change(screen.getByLabelText(i18n.t('enrollment.contactEmail')), {
      target: { value: 'sacha@contact.com' },
    });
    expect(detailsContinue).not.toBeDisabled();
    fireEvent.click(detailsContinue);
    fireEvent.click(screen.getByText('subjects-next'));

    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalled());
    const payload = h.calls.find((c) => c.name === 'enrollTutor')!.payload as Record<string, unknown>;
    expect(payload.crossApp).toBe(true);
    // The supplement carries ONLY the gap being filled.
    expect(payload.enrollment).toEqual({ contactEmail: 'sacha@contact.com' });
  });

  it('a malformed contact email blocks the details continue even with a phone present', () => {
    h.auth = { firebaseUser: { uid: 'b1' }, userDoc: babysitterNoContactDoc, loading: false };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));

    fireEvent.change(screen.getByLabelText(i18n.t('enrollment.contactPhone')), {
      target: { value: '+33600000002' },
    });
    fireEvent.change(screen.getByLabelText(i18n.t('enrollment.contactEmail')), {
      target: { value: 'x@y' },
    });
    expect(screen.getByRole('button', { name: i18n.t('common.continue') })).toBeDisabled();
    expect(screen.getByText(i18n.t('enrollment.contactEmailInvalid'))).toBeInTheDocument();
  });

  it('a degenerate doc (identity gaps too) renders name, DOB, class, gender AND contact inputs', () => {
    h.auth = { firebaseUser: { uid: 'b1' }, userDoc: babysitterBareDoc, loading: false };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));

    expect(screen.getByLabelText(i18n.t('enrollment.firstName'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('enrollment.lastName'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('enrollment.dateOfBirth'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('enrollment.classLabel'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('enrollment.gender'))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t('enrollment.contactEmail'))).toBeInTheDocument();
  });

  it('regression (issue #203): the one-tap page NEVER asks for school verification', () => {
    // The classic wizard's StepEmail heading must not exist on any phase of
    // this page — the EJM identity is derived server-side from the sit doc.
    h.auth = { firebaseUser: { uid: 'b1' }, userDoc: babysitterBareDoc, loading: false };
    renderPage();
    expect(screen.queryByText(i18n.t('enrollment.verifySchool'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));
    expect(screen.queryByText(i18n.t('enrollment.verifySchool'))).toBeNull();
  });

  it('profile-exists rejection routes to the tutor portal instead of erroring', async () => {
    h.error = { details: { reason: 'profile-exists', profile: 'tutor' } };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));
    fireEvent.click(screen.getByText('subjects-next'));

    await vi.waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/tutor'));
  });

  // Error translation pins (issue #159): mapping is by details code/reason,
  // never by message strings, and raw server text must never render.
  it('the age-gate rejection (under-15 stored DoB) renders the translated copy, not the raw message', async () => {
    h.error = {
      code: 'functions/failed-precondition',
      message: 'raw-server-age-gate-text',
      details: { code: 'age/under-15' },
    };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));
    fireEvent.click(screen.getByText('subjects-next'));

    expect(await screen.findByText(i18n.t('enrollment.age.under15'))).toBeInTheDocument();
    expect(screen.queryByText('raw-server-age-gate-text')).toBeNull();
  });

  it('a role-exclusive rejection renders the translated exclusivity copy', async () => {
    h.error = {
      code: 'functions/failed-precondition',
      message: 'raw-server-role-exclusive-text',
      details: { reason: 'role-exclusive', profile: 'tutor' },
    };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));
    fireEvent.click(screen.getByText('subjects-next'));

    expect(await screen.findByText(i18n.t('signup.roleExclusiveTutor'))).toBeInTheDocument();
    expect(screen.queryByText('raw-server-role-exclusive-text')).toBeNull();
  });

  it('an unknown error renders the translated generic message and keeps the fallback-wizard link', async () => {
    h.error = { code: 'functions/internal', message: 'raw-server-internal-text' };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.continue') }));
    fireEvent.click(screen.getByText('subjects-next'));

    expect(await screen.findByText(i18n.t('welcomeCross.genericError'))).toBeInTheDocument();
    expect(screen.queryByText('raw-server-internal-text')).toBeNull();
    const fallback = screen.getByRole('link', { name: i18n.t('welcomeCross.fallbackWizard') });
    expect(fallback).toHaveAttribute('href', '/enroll/tutor');
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
