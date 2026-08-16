import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

// Hoisted recorder for the Firestore write so tests can assert the save.
const h = vi.hoisted(() => ({
  updateDoc: vi.fn(() => Promise.resolve()),
}));

// Avoid initializing the real Firebase app in jsdom.
vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  updateDoc: h.updateDoc,
  serverTimestamp: vi.fn(() => 'server-ts'),
}));
// The @/components/ui barrel pulls in the auth store at module scope; stub it
// with a mutable state object — StepProfile reads userDoc from it to decide
// which identity fields are already on file (issue #144).
const authState: {
  firebaseUser: unknown;
  userDoc: Record<string, unknown> | null;
  loading: boolean;
} = { firebaseUser: null, userDoc: null, loading: false };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
    { getState: () => authState },
  ),
}));

import i18n from '@/i18n';
import { StepProfile } from '../StepProfile';

// Fixed clock: 2026-03-01, i.e. school year ending 2026 (valid grad years
// 26–29). Only Date is faked so Testing Library's async utilities keep
// working on real timers.
const NOW = new Date('2026-03-01T12:00:00Z');

function renderStep({ email = 'student28@ejm.org', onNext = vi.fn() } = {}) {
  render(
    <I18nextProvider i18n={i18n}>
      <StepProfile uid="u1" email={email} onNext={onNext} />
    </I18nextProvider>,
  );
  return { onNext };
}

function setDob(value: string) {
  fireEvent.change(screen.getByLabelText(i18n.t('enrollment.dateOfBirth')), {
    target: { value },
  });
}

function fillOtherFields() {
  fireEvent.change(screen.getByLabelText(i18n.t('enrollment.firstName')), {
    target: { value: 'Léa' },
  });
  fireEvent.change(screen.getByLabelText(i18n.t('enrollment.lastName')), {
    target: { value: 'Martin' },
  });
  fireEvent.change(screen.getByLabelText(i18n.t('enrollment.classLabel')), {
    target: { value: '2nde' },
  });
}

function continueButton() {
  return screen.getByRole('button', { name: i18n.t('common.continue') });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  i18n.changeLanguage('en');
  h.updateDoc.mockClear();
  authState.userDoc = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('StepProfile age gate (client-only UX; sit server truth is the search backstop)', () => {
  it('under-15 DOB shows the parental-enrollment message and blocks progression', () => {
    // grad 29 → expected 15; DOB age 14 → the under-15 floor fires.
    renderStep({ email: 'student29@ejm.org' });
    fillOtherFields();
    setDob('2011-06-15');

    expect(screen.getByText(i18n.t('enrollment.age.under15'))).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();
  });

  it('DOB/grad-year mismatch beyond one class shows the contact-admin message and blocks progression', () => {
    // grad 29 → expected 15; DOB age 18 → mismatch (never the under-15 text).
    renderStep({ email: 'student29@ejm.org' });
    fillOtherFields();
    setDob('2008-01-15');

    expect(screen.getByText(i18n.t('enrollment.age.mismatch'))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('enrollment.age.under15'))).toBeNull();
    expect(continueButton()).toBeDisabled();
  });

  it('consistent DOB passes: no age error, saves the profile and advances', async () => {
    // grad 28 → expected 16; DOB age 16 → ok.
    const { onNext } = renderStep({ email: 'student28@ejm.org' });
    fillOtherFields();
    setDob('2010-01-15');

    expect(screen.queryByText(i18n.t('enrollment.age.under15'))).toBeNull();
    expect(screen.queryByText(i18n.t('enrollment.age.mismatch'))).toBeNull();
    expect(continueButton()).toBeEnabled();

    fireEvent.click(continueButton());
    await vi.waitFor(() => expect(onNext).toHaveBeenCalled());
    expect(h.updateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dateOfBirth: '2010-01-15' }),
    );
  });

  it('age within one class of the grad-year expectation is accepted (tolerance edge)', () => {
    // grad 28 → expected 16; DOB age 17 → |17 − 16| = 1 → ok.
    renderStep({ email: 'student28@ejm.org' });
    fillOtherFields();
    setDob('2009-01-15');

    expect(screen.queryByText(i18n.t('enrollment.age.mismatch'))).toBeNull();
    expect(continueButton()).toBeEnabled();
  });

  it('falls back to the plain 15–18 range check when the email has no parseable grad year', () => {
    renderStep({ email: 'admin@ejm.org' });
    fillOtherFields();
    setDob('2011-06-15'); // age 14

    expect(screen.getByText(i18n.t('enrollment.ageError'))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('enrollment.age.under15'))).toBeNull();
    expect(continueButton()).toBeDisabled();
  });
});

describe('StepProfile with identity on file (issue #144, set-once identity)', () => {
  const onFileDoc = {
    firstName: 'Iris',
    lastName: 'Martin',
    dateOfBirth: '2008-01-15',
    profiles: { tutor: {} },
  };

  it('renders the read-only identity line instead of the identity inputs', () => {
    authState.userDoc = onFileDoc;
    renderStep();

    expect(
      screen.getByText(i18n.t('enrollment.identityOnFile', { name: 'Iris Martin' })),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(i18n.t('enrollment.firstName'))).toBeNull();
    expect(screen.queryByLabelText(i18n.t('enrollment.lastName'))).toBeNull();
    expect(screen.queryByLabelText(i18n.t('enrollment.dateOfBirth'))).toBeNull();
    // classLevel and gender are profile-scoped and still collected.
    expect(screen.getByLabelText(i18n.t('enrollment.classLabel'))).toBeInTheDocument();
  });

  it('saves WITHOUT the identity keys and WITH the profile-scoped fields', async () => {
    authState.userDoc = onFileDoc;
    const { onNext } = renderStep();

    fireEvent.change(screen.getByLabelText(i18n.t('enrollment.classLabel')), {
      target: { value: '2nde' },
    });
    expect(continueButton()).toBeEnabled();
    fireEvent.click(continueButton());

    await vi.waitFor(() => expect(onNext).toHaveBeenCalled());
    expect(h.updateDoc).toHaveBeenCalledTimes(1);
    const payload = (h.updateDoc.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain('firstName');
    expect(Object.keys(payload)).not.toContain('lastName');
    expect(Object.keys(payload)).not.toContain('dateOfBirth');
    expect(payload['profiles.babysitter.classLevel']).toBe('2nde');
    expect(payload).toHaveProperty('profiles.babysitter.gender');
  });

  it('a doc WITHOUT identity keeps the full input form and writes all fields', async () => {
    authState.userDoc = { profiles: { babysitter: {} } };
    const { onNext } = renderStep();

    fillOtherFields();
    setDob('2010-01-15');
    fireEvent.click(continueButton());

    await vi.waitFor(() => expect(onNext).toHaveBeenCalled());
    const payload = (h.updateDoc.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(payload.firstName).toBe('Léa');
    expect(payload.lastName).toBe('Martin');
    expect(payload.dateOfBirth).toBe('2010-01-15');
  });
});
