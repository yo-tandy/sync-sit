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

  it('renders exactly the family scenario list: proposals, confirmation, cancellation, reminders, endorsements', () => {
    renderWithProviders(<AccountPage />);
    // Tutor-initiated proposals arrive under newRequest — without this row the
    // category was unmutable from study-web (issue #168 Phase 0).
    const labels = ['Session proposals', 'Confirmation', 'Cancellation', 'Reminder', 'Endorsements'];
    for (const label of labels) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('toggling a scenario ABSENT from the stored doc writes the FULL channel map', async () => {
    renderWithProviders(<AccountPage />);
    // references is absent from the stored prefs → treated as email-on; the
    // first toggle turns it off. A single-channel dot-path here would create
    // a half-populated map ({email} with no push) that sit's UI reads as
    // "push off" while the server still sends — so the write must carry the
    // full map, with push matching the server's default-on gate.
    fireEvent.click(screen.getByRole('button', { name: 'Endorsements' }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['notifPrefs.references', 'updatedAt']);
    expect(payload['notifPrefs.references']).toEqual({ push: true, email: false });
  });

  it('toggling a HALF-POPULATED stored scenario ({email} with no push) also writes the full map', async () => {
    // Docs the pre-fix dot-path code created on main: the key exists but the
    // push channel is missing. The completeness check (not mere presence)
    // must heal these on the next toggle — push defaults to the server's
    // default-on gate.
    const userDoc = makeUserDoc();
    userDoc.notifPrefs = { ...userDoc.notifPrefs, confirmed: { email: true } } as never;
    h.auth.userDoc = userDoc;
    renderWithProviders(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmation' }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['notifPrefs.confirmed', 'updatedAt']);
    expect(payload['notifPrefs.confirmed']).toEqual({ push: true, email: false });
  });

  it('sends a password reset email to the login address', async () => {
    renderWithProviders(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: /password reset/i }));
    await waitFor(() =>
      expect(h.auth.resetPassword).toHaveBeenCalledWith('parent@example.com'),
    );
  });
});
