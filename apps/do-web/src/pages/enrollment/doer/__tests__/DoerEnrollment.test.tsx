import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// The step-SEQUENCE logic is the unit under test: which steps each caller
// class sees (classic / authed-no-profile / cross-app), and that the
// abbreviated cross-app flow still collects a missing DOB (the §11.1 gate
// requires one from every caller).
const h = vi.hoisted(() => ({
  state: {
    firebaseUser: null as unknown,
    userDoc: null as unknown,
    loading: false,
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  callable: vi.fn(() => Promise.resolve({ data: { uid: 'u1' } })),
}));

vi.mock('@/config/firebase', () => ({ auth: {}, db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => h.callable),
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

beforeEach(() => {
  h.state.firebaseUser = null;
  h.state.userDoc = null;
  h.callable.mockClear();
});

describe('DoerEnrollment — step sequences', () => {
  it('signed out (classic): starts on the EJM email step', () => {
    renderWithProviders(<DoerEnrollment />);
    expect(screen.getByText('Verify your school')).toBeTruthy();
  });

  it('authed WITHOUT a completed cross-app profile: still starts on the email step (code-verified add-profile)', () => {
    h.state.firebaseUser = { uid: 'kid1' };
    h.state.userDoc = { uid: 'kid1', profiles: {} };
    renderWithProviders(<DoerEnrollment />);
    expect(screen.getByText('Verify your school')).toBeTruthy();
  });

  it('cross-app (completed sit profile, full identity on file): consent first, then the details step directly — no email, no password, no profile step', async () => {
    h.state.firebaseUser = { uid: 'sitter1' };
    h.state.userDoc = {
      uid: 'sitter1',
      firstName: 'Zoé',
      lastName: 'Martin',
      dateOfBirth: '2009-01-15',
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

  it('cross-app with a MISSING DOB: the profile step appears and asks for exactly the DOB (no contact re-entry)', async () => {
    h.state.firebaseUser = { uid: 'sitter2' };
    h.state.userDoc = {
      uid: 'sitter2',
      firstName: 'Léo',
      lastName: 'Durand',
      // dateOfBirth absent — the pre-age-gate sit account shape.
      profiles: { babysitter: { enrollmentComplete: true } },
    };
    renderWithProviders(<DoerEnrollment />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Agree & continue' }));

    await waitFor(() => expect(screen.getByLabelText('Date of birth *')).toBeTruthy());
    // Names are on file; the abbreviated flow never re-collects contact.
    expect(screen.queryByLabelText('First name *')).toBeNull();
    expect(screen.queryByLabelText('Contact email')).toBeNull();
  });

  it('cross-app submit sends crossApp: true, the consent version, and no password', async () => {
    h.state.firebaseUser = { uid: 'sitter1' };
    h.state.userDoc = {
      uid: 'sitter1',
      firstName: 'Zoé',
      lastName: 'Martin',
      dateOfBirth: '2009-01-15',
      profiles: { babysitter: { enrollmentComplete: true } },
    };
    // Post-enroll profile-load check resolves via the mocked store state —
    // give the store a doer profile as soon as the callable resolves.
    h.callable.mockImplementation((() => {
      h.state.userDoc = {
        ...(h.state.userDoc as Record<string, unknown>),
        profiles: { babysitter: { enrollmentComplete: true }, doer: { enrollmentComplete: true } },
      };
      return Promise.resolve({ data: { uid: 'sitter1' } });
    }) as never);
    renderWithProviders(<DoerEnrollment />);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Agree & continue' }));
    await waitFor(() => expect(screen.getByText('What would you like to do?')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Complete sign-up' }));

    await waitFor(() => expect(h.callable).toHaveBeenCalledTimes(1));
    const payload = h.callable.mock.calls[0]![0] as Record<string, unknown>;
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
});
