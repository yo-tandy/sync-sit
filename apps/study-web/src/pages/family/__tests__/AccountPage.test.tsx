import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The family account page reads the auth
// store for identity (read-only) and contact (editable) fields, writes contact
// to profiles.parent.* + notifPrefs via updateDoc, and sends password reset
// through resetPassword.
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 'p1' } as { uid: string } | null,
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
    uid: 'p1',
    email: 'parent@example.com',
    firstName: 'Dana',
    lastName: 'Cohen',
    notifPrefs: {
      newRequest: { push: true, email: true },
      confirmed: { push: true, email: true },
      cancelled: { push: true, email: true },
      reminders: { push: true, email: false },
    },
    profiles: {
      parent: {
        enrollmentComplete: true,
        familyId: 'fam1',
        phone: '+33 600000000',
        whatsapp: '+33 600000000',
      },
    },
  };
}

function reset() {
  h.auth.firebaseUser = { uid: 'p1' };
  h.auth.userDoc = makeUserDoc();
  h.auth.refreshUserDoc.mockClear();
  h.auth.resetPassword.mockClear();
  h.updateDoc.mockClear();
}

describe('family AccountPage', () => {
  beforeEach(() => reset());

  it('renders the read-only identity fields', () => {
    renderWithProviders(<AccountPage />);
    expect(screen.getByText('Dana')).toBeInTheDocument();
    expect(screen.getByText('Cohen')).toBeInTheDocument();
    expect(screen.getByText('parent@example.com')).toBeInTheDocument();
  });

  it('saves contact info to the nested parent fields', async () => {
    renderWithProviders(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: /save contact/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/p1' }),
        expect.objectContaining({
          'profiles.parent.phone': '+33 600000000',
          'profiles.parent.whatsapp': '+33 600000000',
          updatedAt: 'ts',
        }),
      ),
    );
    // The auth login email is read-only here — never written from this page.
    const payload = h.updateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('email');
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('writes notif prefs as per-scenario email dot-paths (never clobbers push)', async () => {
    renderWithProviders(<AccountPage />);
    // confirmed.email starts true; toggling writes only that email channel.
    fireEvent.click(screen.getByRole('button', { name: 'Confirmation' }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toHaveProperty('notifPrefs.confirmed.email', false);
    const keys = Object.keys(payload);
    // Every key is either updatedAt or a `notifPrefs.<scenario>.email` dot-path.
    expect(keys.every((k) => k === 'updatedAt' || /^notifPrefs\.[a-z]+\.email$/.test(k))).toBe(true);
    // No push channel is ever written from this page.
    expect(keys.some((k) => k.includes('push'))).toBe(false);
  });

  it('sends a password reset email to the login address', async () => {
    renderWithProviders(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: /password reset/i }));
    await waitFor(() =>
      expect(h.auth.resetPassword).toHaveBeenCalledWith('parent@example.com'),
    );
  });
});
