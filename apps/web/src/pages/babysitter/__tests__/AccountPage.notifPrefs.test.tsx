import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';

// Notification-prefs pins for the sit babysitter account page (issue #168
// Phase 0, reshaped by issue #369): toggles must write per-category/channel
// dot-paths INTO THE RIGHT BLOCK, never the whole notifPrefs object (a
// full-object write clobbers blocks study-web may have written after this
// page mounted), and the page must never render another app's rows.
const h = vi.hoisted(() => ({
  auth: {
    userDoc: null as Record<string, unknown> | null,
    firebaseUser: { uid: 'bs1' },
    refreshUserDoc: vi.fn(() => Promise.resolve()),
    resetPassword: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn<(ref: { path: string }, data: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve(),
  ),
  // Controls isRunningAsPWA per test: false = web mode (push toggles
  // disabled), true = installed PWA (push toggles live).
  pwaMode: false,
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));

vi.mock('@ejm/sit-core', async (importActual) => {
  const actual = await importActual<typeof import('@ejm/sit-core')>();
  return { ...actual, isRunningAsPWA: () => h.pwaMode };
});

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: [ref: { path: string }, data: Record<string, unknown>]) =>
    h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ path }),
  uploadBytes: vi.fn(() => Promise.resolve()),
  getDownloadURL: vi.fn(() => Promise.resolve('https://firebasestorage.example/new.jpg')),
  deleteObject: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/pushNotifications', () => ({
  isPushSupported: () => false,
  getPushPermissionStatus: () => 'default',
  requestPushPermission: vi.fn(),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import i18n from '@/i18n';
import { BabysitterAccountPage } from '../AccountPage';

function makeUserDoc() {
  return {
    uid: 'bs1',
    email: 'noa28@ejm.org',
    firstName: 'Noa',
    lastName: 'Weiss',
    notifPrefs: {
      shared: {
        reminders: { push: true, email: false },
        references: { push: true, email: true },
      },
      sit: {
        newRequest: { push: true, email: true },
        confirmed: { push: true, email: true },
        cancelled: { push: true, email: true },
      },
      study: {
        newRequest: { push: true, email: true },
        confirmed: { push: true, email: true },
        cancelled: { push: true, email: true },
      },
    },
    profiles: {
      babysitter: { enrollmentComplete: true, searchable: true },
    },
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <BabysitterAccountPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

function reset() {
  i18n.changeLanguage('en');
  h.pwaMode = false;
  h.auth.userDoc = makeUserDoc();
  h.updateDoc.mockClear();
  h.auth.refreshUserDoc.mockClear();
}

describe('babysitter AccountPage notification prefs', () => {
  beforeEach(() => reset());
  afterEach(() => cleanup());

  it('writes notif prefs as per-scenario/channel dot-paths (never the whole object)', async () => {
    renderPage();
    // newRequest.email starts true; toggling writes only that one channel.
    fireEvent.click(
      screen.getByRole('button', {
        name: `${i18n.t('notifications.newRequest')} — ${i18n.t('notifications.emailNotif')}`,
      }),
    );

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const call = h.updateDoc.mock.calls[0];
    expect(call[0]).toEqual(expect.objectContaining({ path: 'users/bs1' }));
    const payload = call[1];
    // Per-engagement category -> THIS app's block, never the shared one and
    // never another app's (issue #369).
    expect(payload).toHaveProperty('notifPrefs.sit.newRequest.email', false);
    const keys = Object.keys(payload);
    // Mutation pin: only the toggled category/channel dot-path + updatedAt.
    // Never the whole notifPrefs object, another category, or a push channel.
    expect(keys.sort()).toEqual(['notifPrefs.sit.newRequest.email', 'updatedAt']);
    expect(keys).not.toContain('notifPrefs');
    expect(keys.some((k) => k.includes('push'))).toBe(false);
    expect(keys.some((k) => k.includes('.study.') || k.includes('.do.'))).toBe(false);
  });

  it('push toggles are DISABLED outside PWA mode (no write at all)', async () => {
    renderPage();
    const button = screen.getByRole('button', {
      name: `${i18n.t('notifications.newRequest')} — ${i18n.t('notifications.push')}`,
    });
    // The disabled attribute is what actually prevents the write in web mode:
    // a disabled button never dispatches the click at all.
    expect(button).toBeDisabled();
    fireEvent.click(button);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('in PWA mode the push toggle is enabled and writes the push dot-path', async () => {
    // Complement of the web-mode pin: with pwaMode true the toggle() guard
    // lets the push channel through and the write is a single-channel
    // dot-path, proving the inertness above comes from the pwa gate.
    h.pwaMode = true;
    renderPage();
    const button = screen.getByRole('button', {
      name: `${i18n.t('notifications.newRequest')} — ${i18n.t('notifications.push')}`,
    });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['notifPrefs.sit.newRequest.push', 'updatedAt']);
    expect(payload['notifPrefs.sit.newRequest.push']).toBe(false);
  });

  it('a SHARED category writes into notifPrefs.shared, not into the app block', async () => {
    // `reminders` is one calendar, not one marketplace (issue #369).
    renderPage();
    fireEvent.click(
      screen.getByRole('button', {
        name: `${i18n.t('notifications.reminder')} — ${i18n.t('notifications.emailNotif')}`,
      }),
    );
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['notifPrefs.shared.reminders.email', 'updatedAt']);
  });

  it('renders the shared block first, then this app\'s block', () => {
    renderPage();
    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((h4) => h4.textContent);
    expect(headings).toEqual([
      i18n.t('notifications.blockShared'),
      i18n.t('notifications.blockApp'),
    ]);
  });

  it('NEVER renders sync/do rows — not even for a user who holds a doer profile', () => {
    // The rendering rule of issue #369 at the surface: a per-app Account page
    // shows the shared block plus ITS OWN app's block. Another app's rows are
    // the shared account hub's business (#367), never this page's — and for a
    // user with no doer profile they must not appear anywhere at all.
    h.auth.userDoc = { ...makeUserDoc() };
    renderPage();
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(2);
    cleanup();

    const withDoer = makeUserDoc();
    (withDoer.profiles as Record<string, unknown>).doer = { enrollmentComplete: true };
    h.auth.userDoc = withDoer;
    renderPage();
    // Still exactly two blocks: shared + sit. The doer profile adds a block to
    // `notifPrefRowsForUser`, and this page filters it out by scope.
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(2);
  });

  it('still reads a pre-#369 FLAT doc during the transitional window', async () => {
    // Un-backfilled docs must render the user's real choice, not a default.
    h.auth.userDoc = {
      ...makeUserDoc(),
      notifPrefs: { newRequest: { push: true, email: false } },
    };
    renderPage();
    const emailToggle = screen.getByRole('button', {
      name: `${i18n.t('notifications.newRequest')} — ${i18n.t('notifications.emailNotif')}`,
    });
    // Rendered OFF (the stored flat value), so toggling turns it back ON.
    fireEvent.click(emailToggle);
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(payload['notifPrefs.sit.newRequest.email']).toBe(true);
  });
});
