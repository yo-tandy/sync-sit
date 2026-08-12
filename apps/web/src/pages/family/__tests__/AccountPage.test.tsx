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
  updateDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/config/firebase', () => ({ db: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
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
  return { ...actual, isRunningAsPWA: () => false };
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
        h.updateDoc.mock.calls.some((c) => (c[0] as { path: string }).path === 'users/p1'),
      ).toBe(true),
    );
    const userCall = h.updateDoc.mock.calls.find(
      (c) => (c[0] as { path: string }).path === 'users/p1',
    )!;
    expect(userCall[1]).not.toHaveProperty('email');
    expect(userCall[1]).toHaveProperty('profiles.parent.phone');
  });
});
