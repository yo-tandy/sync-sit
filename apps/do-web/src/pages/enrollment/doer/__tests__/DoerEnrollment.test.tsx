import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// The step-SEQUENCE logic is the unit under test: which steps each caller
// class sees (classic / authed-no-provider-profile / cross-app), that the
// abbreviated cross-app flow still collects a missing DOB (§11.1) and a
// missing contact channel (the every-path contact requirement, PR #320),
// and the exact payload each path submits.
const h = vi.hoisted(() => ({
  state: {
    firebaseUser: null as unknown,
    userDoc: null as unknown,
    loading: false,
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  // Per-name callable dispatcher: httpsCallable(functions, name) returns a
  // fn that routes here, so tests can assert each callable's payload.
  invoke: vi.fn<(name: string, data?: unknown) => Promise<{ data: unknown }>>(() =>
    Promise.resolve({ data: {} }),
  ),
}));

vi.mock('@/config/firebase', () => ({ auth: {}, db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(
    (_f: unknown, name: string) => (data?: unknown) => h.invoke(name, data),
  ),
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/adminConfigClient', () => ({
  useClientConfigValue: (_k: string, d: number) => d,
}));
vi.mock('@/stores/authStore', () => ({
  markNextSignInFresh: vi.fn(),
  useAuthStore: Object.assign(
    () => h.state,
    {
      getState: () => h.state,
      subscribe: () => () => {},
    },
  ),
}));

import { DoerEnrollment } from '../DoerEnrollment';

/** Calls to one callable name, payloads only. */
function callsTo(name: string): unknown[] {
  return h.invoke.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
}

beforeEach(() => {
  h.state.firebaseUser = null;
  h.state.userDoc = null;
  h.invoke.mockClear();
  h.invoke.mockImplementation(() => Promise.resolve({ data: {} }));
});

describe('DoerEnrollment — step sequences', () => {
  it('signed out (classic): starts on the EJM email step', () => {
    renderWithProviders(<DoerEnrollment />);
    expect(screen.getByText('Verify your school')).toBeTruthy();
  });

  it('authed WITHOUT a completed provider profile: still starts on the email step (code-verified add-profile)', () => {
    h.state.firebaseUser = { uid: 'kid1' };
    h.state.userDoc = { uid: 'kid1', profiles: {} };
    renderWithProviders(<DoerEnrollment />);
    expect(screen.getByText('Verify your school')).toBeTruthy();
  });

  it('a PARENT profile does not take the abbreviated path (PR #320): the code-verified sequence shows instead', () => {
    h.state.firebaseUser = { uid: 'parent1' };
    h.state.userDoc = {
      uid: 'parent1',
      firstName: 'Marie',
      lastName: 'Dupont',
      profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
    };
    renderWithProviders(<DoerEnrollment />);
    // Not the consent-only cross-app entry — the EJM email step, whose
    // verification is the only identity a parent profile can offer.
    expect(screen.getByText('Verify your school')).toBeTruthy();
  });

  it('cross-app (completed sit profile, identity + contact on file): consent first, then the details step directly — no email, no password, no profile step', async () => {
    h.state.firebaseUser = { uid: 'sitter1' };
    h.state.userDoc = {
      uid: 'sitter1',
      firstName: 'Zoé',
      lastName: 'Martin',
      dateOfBirth: '2009-01-15',
      contactEmail: 'zoe@test.com',
      profiles: { babysitter: { enrollmentComplete: true } },
    };
    renderWithProviders(<DoerEnrollment />);

    // Consent-only step (no password inputs).
    expect(screen.getByText('Almost there')).toBeTruthy();
    expect(screen.queryByText('Create your password')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Agree & continue' }));

    // Straight to the doer details step: identity is complete, so the
    // profile step is skipped (§3.3 — collect only categories, transport,
    // bio, consent).
    await waitFor(() => expect(screen.getByText('What would you like to do?')).toBeTruthy());
    // All seven categories preselected (the modal intent stated as data).
    const pressed = screen.getAllByRole('button', { pressed: true });
    expect(pressed.length).toBeGreaterThanOrEqual(7);
  });

  it('cross-app with a MISSING DOB: the profile step appears and asks for exactly the DOB (contact on file stays hidden)', async () => {
    h.state.firebaseUser = { uid: 'sitter2' };
    h.state.userDoc = {
      uid: 'sitter2',
      firstName: 'Léo',
      lastName: 'Durand',
      // dateOfBirth absent — the pre-age-gate sit account shape. A nested
      // contact channel keeps the contact section hidden, so this case
      // isolates the DOB collection.
      profiles: { babysitter: { enrollmentComplete: true, contactEmail: 'leo@ejm.org' } },
    };
    renderWithProviders(<DoerEnrollment />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Agree & continue' }));

    await waitFor(() => expect(screen.getByLabelText('Date of birth *')).toBeTruthy());
    // Names are on file; contact exists on the account, so it is not
    // re-collected.
    expect(screen.queryByLabelText('First name *')).toBeNull();
    expect(screen.queryByLabelText('Contact email')).toBeNull();
  });

  it('cross-app with NO contact channel anywhere: the profile step appears to collect one (the every-path contact requirement, PR #320)', async () => {
    h.state.firebaseUser = { uid: 'sitter3' };
    h.state.userDoc = {
      uid: 'sitter3',
      firstName: 'Ana',
      lastName: 'Faure',
      dateOfBirth: '2009-05-20',
      // Sit's enrollment makes contact skippable (issue #203): no root
      // channels and none on the nested profile.
      profiles: { babysitter: { enrollmentComplete: true } },
    };
    renderWithProviders(<DoerEnrollment />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Agree & continue' }));

    // Identity is fully on file — only the contact section is collected.
    await waitFor(() => expect(screen.getByLabelText('Contact email')).toBeTruthy());
    expect(screen.queryByLabelText('First name *')).toBeNull();
    expect(screen.queryByLabelText('Date of birth *')).toBeNull();

    // And it gates: with no channel typed, Continue stays disabled.
    const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Contact phone'), { target: { value: '+33 611111111' } });
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('cross-app submit sends crossApp: true, the consent version, and no password', async () => {
    h.state.firebaseUser = { uid: 'sitter1' };
    h.state.userDoc = {
      uid: 'sitter1',
      firstName: 'Zoé',
      lastName: 'Martin',
      dateOfBirth: '2009-01-15',
      contactEmail: 'zoe@test.com',
      profiles: { babysitter: { enrollmentComplete: true } },
    };
    // Post-enroll profile-load check resolves via the mocked store state —
    // give the store a doer profile as soon as the callable resolves.
    h.invoke.mockImplementation((name: string) => {
      if (name === 'doEnrollDoer') {
        h.state.userDoc = {
          ...(h.state.userDoc as Record<string, unknown>),
          profiles: { babysitter: { enrollmentComplete: true }, doer: { enrollmentComplete: true } },
        };
        return Promise.resolve({ data: { uid: 'sitter1' } });
      }
      return Promise.resolve({ data: {} });
    });
    renderWithProviders(<DoerEnrollment />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Agree & continue' }));
    await waitFor(() => expect(screen.getByText('What would you like to do?')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Complete sign-up' }));

    await waitFor(() => expect(callsTo('doEnrollDoer')).toHaveLength(1));
    const payload = callsTo('doEnrollDoer')[0] as Record<string, unknown>;
    expect(payload.crossApp).toBe(true);
    expect(payload.password).toBeUndefined();
    expect(payload.ejemEmail).toBeUndefined();
    expect(typeof payload.consentVersion).toBe('string');
    const enrollment = payload.enrollment as Record<string, unknown>;
    // Identity on file → omitted; categories default to ALL seven.
    expect(enrollment.firstName).toBeUndefined();
    expect(enrollment.dateOfBirth).toBeUndefined();
    expect(enrollment.categories).toHaveLength(7);
    expect(enrollment.notifyNewTasks).toBe(true);
  });

  it('classic signed-out submit sends ejemEmail + verificationCode + password and NO crossApp flag', async () => {
    // StepEmail's client validation enforces the live graduation-year
    // window, so the fixture email is computed for a ~16-year-old cohort.
    const d = new Date();
    const schoolYearEnd = d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
    const grad = String((schoolYearEnd + 2) % 100).padStart(2, '0');
    const typedEmail = `New.Doer${grad}@ejm.org`;
    h.invoke.mockImplementation((name: string) => {
      if (name === 'doEnrollDoer') {
        // Flip the store to a settled signed-in doer so the post-enroll
        // wait resolves immediately instead of running its 5s timeout.
        h.state.firebaseUser = { uid: 'new1' };
        h.state.userDoc = { uid: 'new1', profiles: { doer: { enrollmentComplete: true } } };
        return Promise.resolve({ data: { uid: 'new1' } });
      }
      return Promise.resolve({ data: {} });
    });
    renderWithProviders(<DoerEnrollment />);

    // Step 0 — EJM email.
    fireEvent.change(screen.getByLabelText('EJM email address *'), {
      target: { value: typedEmail },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }));
    await waitFor(() => expect(callsTo('verifyEjmEmail')).toHaveLength(1));
    expect(callsTo('verifyEjmEmail')[0]).toMatchObject({ email: typedEmail, app: 'do' });

    // Step 1 — the 6-digit code; each digit into its own box.
    await waitFor(() => expect(screen.getByText('Check your email')).toBeTruthy());
    const boxes = screen.getAllByRole('textbox').filter((el) => el.getAttribute('maxlength') === '1');
    '123456'.split('').forEach((d, i) => fireEvent.change(boxes[i]!, { target: { value: d } }));
    await waitFor(() => expect(callsTo('verifyCode')).toHaveLength(1));

    // Step 2 — password + consent.
    await waitFor(() => expect(screen.getByText('Create your password')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Str0ngPass1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Str0ngPass1' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    // Step 3 — profile (identity + contact).
    await waitFor(() => expect(screen.getByLabelText('First name *')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('Last name *'), { target: { value: 'Doer' } });
    fireEvent.change(screen.getByLabelText('Date of birth *'), { target: { value: '2009-02-10' } });
    fireEvent.change(screen.getByLabelText('Contact email'), { target: { value: 'new@test.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 4 — details, submit.
    await waitFor(() => expect(screen.getByText('What would you like to do?')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Complete sign-up' }));

    await waitFor(() => expect(callsTo('doEnrollDoer')).toHaveLength(1));
    const payload = callsTo('doEnrollDoer')[0] as Record<string, unknown>;
    expect(payload.crossApp).toBeUndefined();
    expect(payload.ejemEmail).toBe(typedEmail.toLowerCase()); // trimmed + lowercased
    expect(payload.verificationCode).toBe('123456');
    expect(payload.password).toBe('Str0ngPass1');
    const enrollment = payload.enrollment as Record<string, unknown>;
    expect(enrollment).toMatchObject({
      firstName: 'New',
      lastName: 'Doer',
      dateOfBirth: '2009-02-10',
      contactEmail: 'new@test.com',
    });
  });

  it('the flow shape is FROZEN at auth-resolution: a mid-flow userDoc update cannot shrink the steps under the live index (PR #320 round 2)', async () => {
    // Cross-app zero-channel flow: steps = [consent, profile, details]. The
    // submit persists the collected contact, and the store update that
    // follows would flip crossAppNeedsProfileStep false — with a LIVE
    // steps array, steps[2] becomes undefined and the wizard renders blank
    // for the frames before navigation. Frozen steps keep index 2 on
    // 'details'.
    h.state.firebaseUser = { uid: 'sitter3' };
    h.state.userDoc = {
      uid: 'sitter3',
      firstName: 'Ana',
      lastName: 'Faure',
      dateOfBirth: '2009-05-20',
      profiles: { babysitter: { enrollmentComplete: true } },
    };
    h.invoke.mockImplementation((name: string) => {
      if (name === 'doEnrollDoer') {
        // The post-submit refresh lands the contact AND the doer profile —
        // both of which change the computed flow shape.
        h.state.userDoc = {
          ...(h.state.userDoc as Record<string, unknown>),
          contactEmail: 'ana@test.com',
          profiles: { babysitter: { enrollmentComplete: true }, doer: { enrollmentComplete: true } },
        };
        return Promise.resolve({ data: { uid: 'sitter3' } });
      }
      return Promise.resolve({ data: {} });
    });
    renderWithProviders(<DoerEnrollment />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Agree & continue' }));
    await waitFor(() => expect(screen.getByLabelText('Contact email')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Contact email'), { target: { value: 'ana@test.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('What would you like to do?')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Complete sign-up' }));

    await waitFor(() => expect(callsTo('doEnrollDoer')).toHaveLength(1));
    // The re-render after the store update must still show the details
    // step, not fall through renderStep's default to a blank page.
    expect(screen.getByText('What would you like to do?')).toBeTruthy();
  });

  it('an age-gate rejection maps to the under-15 copy (applyEnrollmentError)', async () => {
    h.state.firebaseUser = { uid: 'sitter1' };
    h.state.userDoc = {
      uid: 'sitter1',
      firstName: 'Zoé',
      lastName: 'Martin',
      dateOfBirth: '2013-01-15',
      contactEmail: 'zoe@test.com',
      profiles: { babysitter: { enrollmentComplete: true } },
    };
    h.invoke.mockImplementation((name: string) => {
      if (name === 'doEnrollDoer') {
        return Promise.reject(
          Object.assign(new Error('You need to be at least 15 to enroll on your own.'), {
            details: { reason: 'under_15', code: 'age/under-15' },
          }),
        );
      }
      return Promise.resolve({ data: {} });
    });
    renderWithProviders(<DoerEnrollment />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Agree & continue' }));
    await waitFor(() => expect(screen.getByText('What would you like to do?')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Complete sign-up' }));

    // The translated i18n copy, not the raw server message.
    await waitFor(() =>
      expect(
        screen.getByText(
          'You need to be at least 15 to enroll on your own. Your parents can create an account and enroll you from theirs.',
        ),
      ).toBeTruthy(),
    );
  });
});
