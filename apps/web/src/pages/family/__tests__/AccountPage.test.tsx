import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';

// Hoisted, test-controllable state. The account page reads identity/contact
// off the parent view and writes contact fields to users/{uid} via updateDoc.
const h = vi.hoisted(() => ({
  auth: {
    userDoc: null as unknown,
    firebaseUser: { uid: 'p1' } as { uid: string } | null,
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

vi.mock('@/config/firebase', () => ({ db: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: [ref: { path: string }, data: Record<string, unknown>]) =>
    h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(() => Promise.resolve()),
  getDownloadURL: vi.fn(() => Promise.resolve('https://example.com/photo.jpg')),
}));

vi.mock('@/lib/pushNotifications', () => ({
  isPushSupported: () => false,
  getPushPermissionStatus: () => 'default',
  requestPushPermission: vi.fn(),
}));

vi.mock('@ejm/sit-core', async (importActual) => {
  const actual = await importActual<typeof import('@ejm/sit-core')>();
  return { ...actual, isRunningAsPWA: () => h.pwaMode };
});

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import i18n from '@/i18n';
import { AccountPage } from '../AccountPage';

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

function reset() {
  i18n.changeLanguage('en');
  h.pwaMode = false;
  h.auth.userDoc = {
    uid: 'p1',
    email: 'parent@example.com',
    profiles: { parent: { familyId: 'fam1', phone: '+33100000000' } },
  };
  h.updateDoc.mockClear();
  h.auth.refreshUserDoc.mockClear();
}

describe('family AccountPage', () => {
  beforeEach(() => reset());
  afterEach(() => cleanup());

  it('shows the login email read-only (not as an editable input)', async () => {
    renderPage();
    // The login email is rendered as read-only text in the personal-info card.
    expect(await screen.findByText('parent@example.com')).toBeInTheDocument();
    // There is no editable email field on the account page.
    expect(screen.queryByLabelText(i18n.t('common.email'))).not.toBeInTheDocument();
  });

  it('saving contact info does NOT write a top-level email key (Firebase Auth desync)', async () => {
    renderPage();
    await screen.findByText('parent@example.com');

    fireEvent.click(screen.getByRole('button', { name: i18n.t('account.saveContact') }));

    await waitFor(() =>
      expect(
        h.updateDoc.mock.calls.some((c) => c[0].path === 'users/p1'),
      ).toBe(true),
    );
    const userCall = h.updateDoc.mock.calls.find(
      (c) => c[0].path === 'users/p1',
    )!;
    expect(userCall[1]).not.toHaveProperty('email');
    expect(userCall[1]).toHaveProperty('profiles.parent.phone');
  });

  it('writes notif prefs as per-scenario/channel dot-paths (never the whole object)', async () => {
    h.auth.userDoc = {
      uid: 'p1',
      email: 'parent@example.com',
      notifPrefs: {
        newRequest: { push: true, email: true },
        confirmed: { push: true, email: true },
        cancelled: { push: true, email: true },
        reminders: { push: true, email: false },
      },
      profiles: { parent: { familyId: 'fam1', phone: '+33100000000' } },
    };
    renderPage();
    await screen.findByText('parent@example.com');

    // confirmed.email starts true; toggling writes only that one channel.
    fireEvent.click(
      screen.getByRole('button', {
        name: `${i18n.t('notifications.confirmation')} — ${i18n.t('notifications.emailNotif')}`,
      }),
    );

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(payload).toHaveProperty('notifPrefs.confirmed.email', false);
    const keys = Object.keys(payload);
    // Mutation pin: only the toggled scenario/channel dot-path + updatedAt.
    // Never the whole notifPrefs object (would clobber values study-web owns)
    // and never another scenario or the push channel.
    expect(keys.sort()).toEqual(['notifPrefs.confirmed.email', 'updatedAt']);
    expect(keys).not.toContain('notifPrefs');
    expect(keys.some((k) => k.includes('push'))).toBe(false);
  });

  it('push toggles are DISABLED outside PWA mode (no write at all)', async () => {
    renderPage();
    await screen.findByText('parent@example.com');
    const button = screen.getByRole('button', {
      name: `${i18n.t('notifications.confirmation')} — ${i18n.t('notifications.push')}`,
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
    await screen.findByText('parent@example.com');
    const button = screen.getByRole('button', {
      name: `${i18n.t('notifications.confirmation')} — ${i18n.t('notifications.push')}`,
    });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['notifPrefs.confirmed.push', 'updatedAt']);
    expect(payload['notifPrefs.confirmed.push']).toBe(false);
  });

  it('a typed phone number SURVIVES the render it causes (seeded once per mount)', async () => {
    // `parent` is a fresh object every render (getParentView spreads), so an
    // unguarded `[parent]` seeding effect re-fires on the very render its own
    // setters trigger and resets the field to the stored value — the parent
    // cannot change their phone number at all. study-web fixed this on its
    // copy of this page (PR #206 review); sit's copy was never updated.
    renderPage();
    await screen.findByText('parent@example.com');

    const phoneInput = screen.getAllByRole('textbox')[0] as HTMLInputElement;
    // Seeded from profiles.parent.phone = '+33100000000' (FR code stripped).
    expect(phoneInput.value).toBe('100000000');

    fireEvent.change(phoneInput, { target: { value: '612345678' } });

    expect(phoneInput.value).toBe('612345678');
    // And it is still the typed value one macrotask later, after every
    // effect the change scheduled has flushed.
    await waitFor(() => expect(phoneInput.value).toBe('612345678'));
  });

  it('saves the TYPED phone, not the value the page was seeded with', async () => {
    // The consequence the test above guards, at the write boundary: without
    // the guard the save payload carries the stored number back to itself.
    renderPage();
    await screen.findByText('parent@example.com');

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '612345678' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('account.saveContact') }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const userCall = h.updateDoc.mock.calls.find((c) => c[0].path === 'users/p1')!;
    expect(userCall[1]['profiles.parent.phone']).toBe('+33 612345678');
  });
});
