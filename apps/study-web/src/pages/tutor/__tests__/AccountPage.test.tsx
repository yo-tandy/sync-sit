import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The account page reads the auth store for
// identity (read-only) and contact (editable) fields and writes contact +
// notifPrefs back via updateDoc; password reset goes through resetPassword.
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 't1' } as { uid: string } | null,
    userDoc: null as unknown,
    refreshUserDoc: vi.fn(() => Promise.resolve()),
    resetPassword: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/config/firebase', () => ({ db: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { AccountPage } from '../AccountPage';

function makeUserDoc() {
  return {
    uid: 't1',
    email: 'login@ejm.org',
    firstName: 'Alice',
    lastName: 'Martin',
    dateOfBirth: '2008-05-01',
    notifPrefs: {
      newRequest: { push: true, email: true },
      confirmed: { push: true, email: true },
      cancelled: { push: true, email: true },
      reminders: { push: true, email: false },
    },
    profiles: {
      tutor: {
        enrollmentComplete: true,
        ejemEmail: 'alice.martin24@ejm.org',
        classLevel: 'Terminale',
        contactEmail: 'old@example.com',
        contactPhone: '+33 600000000',
        whatsapp: '+33 600000000',
      },
    },
  };
}

function reset() {
  h.auth.firebaseUser = { uid: 't1' };
  h.auth.userDoc = makeUserDoc();
  h.auth.refreshUserDoc.mockClear();
  h.auth.resetPassword.mockClear();
  h.updateDoc.mockClear();
}

describe('tutor AccountPage', () => {
  beforeEach(() => reset());

  it('renders the read-only identity fields', () => {
    renderWithProviders(<AccountPage />);
    // Name, EJM email and class level come straight from the doc (read-only).
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Martin')).toBeInTheDocument();
    expect(screen.getByText('alice.martin24@ejm.org')).toBeInTheDocument();
    expect(screen.getByText('Terminale')).toBeInTheDocument();
    expect(screen.getByText('login@ejm.org')).toBeInTheDocument();
  });

  it('saves contact info to the nested tutor fields', async () => {
    renderWithProviders(<AccountPage />);
    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    expect(emailInput.value).toBe('old@example.com');
    fireEvent.change(emailInput, { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save contact/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/t1' }),
        expect.objectContaining({
          'profiles.tutor.contactEmail': 'new@example.com',
          'profiles.tutor.contactPhone': '+33 600000000',
          'profiles.tutor.whatsapp': '+33 600000000',
          updatedAt: 'ts',
        }),
      ),
    );
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('sends a password reset email to the login address', async () => {
    renderWithProviders(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: /password reset/i }));
    await waitFor(() =>
      expect(h.auth.resetPassword).toHaveBeenCalledWith('login@ejm.org'),
    );
  });

  // ── Cancellation policy (V2 feature 7) ──
  it('seeds the cancellation-policy selector from the stored value', () => {
    const userDoc = makeUserDoc();
    (userDoc.profiles.tutor as Record<string, unknown>).cancellationNoticeHours = 48;
    h.auth.userDoc = userDoc;
    renderWithProviders(<AccountPage />);
    const select = screen.getByLabelText(/cancellation policy/i) as HTMLSelectElement;
    expect(select.value).toBe('48');
  });

  it('defaults the selector to 0 (no policy) when the field is absent', () => {
    renderWithProviders(<AccountPage />);
    const select = screen.getByLabelText(/cancellation policy/i) as HTMLSelectElement;
    expect(select.value).toBe('0');
  });

  it('saves the selected policy to the numeric dot-path and refreshes', async () => {
    renderWithProviders(<AccountPage />);
    fireEvent.change(screen.getByLabelText(/cancellation policy/i), { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/t1' }),
        expect.objectContaining({
          'profiles.tutor.cancellationNoticeHours': 48,
          updatedAt: 'ts',
        }),
      ),
    );
    // The value is the NUMBER 48, never the string '48'.
    const call = h.updateDoc.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)['profiles.tutor.cancellationNoticeHours'] !== undefined,
    );
    expect(call?.[1]['profiles.tutor.cancellationNoticeHours']).toBe(48);
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('saves the 1-week (168) preset as its numeric value', async () => {
    renderWithProviders(<AccountPage />);
    fireEvent.change(screen.getByLabelText(/cancellation policy/i), { target: { value: '168' } });
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/t1' }),
        expect.objectContaining({ 'profiles.tutor.cancellationNoticeHours': 168 }),
      ),
    );
  });
});
