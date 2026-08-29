import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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
  updateDoc: vi.fn<(ref: { path: string }, data: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve(),
  ),
}));

vi.mock('@/config/firebase', () => ({ db: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: [ref: { path: string }, data: Record<string, unknown>]) =>
    h.updateDoc(...args),
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
      shared: { reminders: { push: true, email: false } },
      study: {
        newRequest: { push: true, email: true },
        confirmed: { push: true, email: true },
        cancelled: { push: true, email: true },
      },
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
    const payload = h.updateDoc.mock.calls[0][1];
    expect(payload).not.toHaveProperty('email');
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('writes notif prefs as per-category dot-paths into THIS app\'s block', async () => {
    renderWithProviders(<AccountPage />);
    // confirmed.email starts true; toggling writes only that email channel.
    fireEvent.click(screen.getByRole('button', { name: 'Confirmation — Email' }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(payload).toHaveProperty('notifPrefs.study.confirmed.email', false);
    const keys = Object.keys(payload);
    // Every key is either updatedAt or the toggled block/category/channel path.
    expect(
      keys.every((k) => k === 'updatedAt' || /^notifPrefs\.(shared|sit|study|do)\.[a-z]+\.(email|push)$/i.test(k)),
    ).toBe(true);
    // The untouched push channel is never written by an email toggle, and no
    // other app's block is ever touched (issue #369).
    expect(keys.some((k) => k.includes('push'))).toBe(false);
    expect(keys.some((k) => k.includes('.sit.') || k.includes('.do.'))).toBe(false);
  });

  it('a SHARED category writes into notifPrefs.shared, not into the app block', async () => {
    renderWithProviders(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Reminder — Email' }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['notifPrefs.shared.reminders.email', 'updatedAt']);
  });

  it('never renders sync/do rows — not even for a family whose account holds a doer profile', () => {
    // The rendering rule of issue #369: a per-app page shows the shared block
    // plus its OWN app's block. do rows belong to the account hub (#367).
    renderWithProviders(<AccountPage />);
    expect(
      screen.getAllByRole('heading', { level: 4 }).map((el) => el.textContent),
    ).toEqual(['All Sync apps', 'Sync/Study']);
    cleanup();

    const withDoer = makeUserDoc();
    (withDoer.profiles as Record<string, unknown>).doer = { enrollmentComplete: true };
    h.auth.userDoc = withDoer;
    renderWithProviders(<AccountPage />);
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(2);
  });

  it('renders exactly the family scenario list: proposals, confirmation, cancellation, reminders, endorsements', () => {
    renderWithProviders(<AccountPage />);
    // Tutor-initiated proposals arrive under newRequest — without this row the
    // category was unmutable from study-web (issue #168 Phase 0). Each
    // scenario now has a push AND an email toggle (issue #168 Phase 1).
    const labels = ['Session proposals', 'Confirmation', 'Cancellation', 'Reminder', 'Endorsements'];
    for (const label of labels) {
      expect(screen.getByRole('button', { name: `${label} — Push` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `${label} — Email` })).toBeInTheDocument();
    }
  });

  it('a category ABSENT from the stored doc still writes a single-channel path', async () => {
    renderWithProviders(<AccountPage />);
    // references is absent from the stored prefs → resolves to the product
    // default (both on); the first toggle turns email off. Before issue #369
    // this had to write the WHOLE map, because a half-populated map read
    // differently in the UI than on the server. `resolveNotifPref` now merges
    // a partial category over the same default on both sides, so the narrow
    // write is correct — and it can no longer clobber a concurrent change.
    fireEvent.click(screen.getByRole('button', { name: 'Endorsements — Email' }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['notifPrefs.shared.references.email', 'updatedAt']);
    expect(payload['notifPrefs.shared.references.email']).toBe(false);
  });

  it('a HALF-POPULATED stored category ({email} with no push) renders push ON, not off', async () => {
    // Docs the pre-#369 dot-path code created: the key exists but the push
    // channel is missing. The UI must read it exactly as the server does —
    // missing channel = product default — instead of rendering it as off.
    const userDoc = makeUserDoc();
    userDoc.notifPrefs = {
      ...userDoc.notifPrefs,
      study: { ...userDoc.notifPrefs.study, confirmed: { email: true } },
    } as never;
    h.auth.userDoc = userDoc;
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(display-mode: standalone)',
    }));
    try {
      renderWithProviders(<AccountPage />);
      const pushToggle = screen.getByRole('button', { name: 'Confirmation — Push' });
      expect(pushToggle.className).toContain('bg-brand-600');
      fireEvent.click(screen.getByRole('button', { name: 'Confirmation — Email' }));
      await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
      const payload = h.updateDoc.mock.calls[0][1];
      expect(Object.keys(payload).sort()).toEqual(['notifPrefs.study.confirmed.email', 'updatedAt']);
      expect(payload['notifPrefs.study.confirmed.email']).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('still reads a pre-#369 FLAT doc during the transitional window', async () => {
    const userDoc = makeUserDoc();
    userDoc.notifPrefs = { confirmed: { push: true, email: false } } as never;
    h.auth.userDoc = userDoc;
    renderWithProviders(<AccountPage />);
    // Rendered OFF (the stored flat value), so toggling turns it back ON.
    fireEvent.click(screen.getByRole('button', { name: 'Confirmation — Email' }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(payload['notifPrefs.study.confirmed.email']).toBe(true);
  });

  it('push toggles are inert in web-app mode (no PWA): nothing is written', async () => {
    // jsdom has no matchMedia/standalone flags — isRunningAsPWA() is false.
    renderWithProviders(<AccountPage />);
    const pushToggle = screen.getByRole('button', { name: 'Confirmation — Push' });
    expect(pushToggle).toBeDisabled();
    // Renders in the OFF position even though the stored pref is on — an ON
    // toggle above the "push needs install" notice reads as a contradiction
    // (PR #192 review; purely visual, the write guard is the real gate).
    expect(pushToggle.className).toContain('bg-gray-300');
    expect(pushToggle.className).not.toContain('bg-brand-600');
    fireEvent.click(pushToggle);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('web-app mode shows the install notice linking /install', () => {
    renderWithProviders(<AccountPage />);
    expect(screen.getByText(/adding the app to your home screen/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /how to install/i })).toHaveAttribute('href', '/install');
  });

  it('PWA mode enables push toggles and writes the push dot-path only', async () => {
    // Simulate installed-PWA mode: display-mode standalone matches.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(display-mode: standalone)',
    }));
    try {
      renderWithProviders(<AccountPage />);
      expect(screen.queryByText(/adding the app to your home screen/i)).toBeNull();
      const pushToggle = screen.getByRole('button', { name: 'Confirmation — Push' });
      expect(pushToggle).not.toBeDisabled();
      fireEvent.click(pushToggle);
      await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
      const payload = h.updateDoc.mock.calls[0][1];
      expect(payload).toHaveProperty('notifPrefs.study.confirmed.push', false);
      const keys = Object.keys(payload);
      expect(
        keys.every((k) => k === 'updatedAt' || /^notifPrefs\.(shared|sit|study|do)\.[a-z]+\.push$/i.test(k)),
      ).toBe(true);
      expect(keys.some((k) => k.includes('email'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends a password reset email to the login address', async () => {
    renderWithProviders(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: /password reset/i }));
    await waitFor(() =>
      expect(h.auth.resetPassword).toHaveBeenCalledWith('parent@example.com'),
    );
  });
});
