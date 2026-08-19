import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';

// Shared-identity pins (issue #203): contact is canonical at the users/{uid}
// ROOT — the Account page saves root-only and seeds from root ?? nested.
const h = vi.hoisted(() => ({
  auth: {
    userDoc: null as Record<string, unknown> | null,
    firebaseUser: { uid: 'bs1' },
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
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

function userDoc(
  babysitterOverrides: Record<string, unknown> = {},
  rootOverrides: Record<string, unknown> = {},
) {
  return {
    uid: 'bs1',
    email: 'noa28@ejm.org',
    firstName: 'Noa',
    lastName: 'Weiss',
    profiles: {
      babysitter: {
        enrollmentComplete: true,
        searchable: true,
        ejemEmail: 'noa28@ejm.org',
        contactSharingConsent: true,
        ...babysitterOverrides,
      },
    },
    notifPrefs: {},
    ...rootOverrides,
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

const contactEmailInput = () =>
  screen.getByLabelText(i18n.t('common.email')) as HTMLInputElement;
const saveButton = () =>
  screen.getByRole('button', { name: i18n.t('account.saveContact') });

describe('BabysitterAccountPage contact (shared identity, issue #203)', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
    h.auth.userDoc = userDoc();
    h.auth.refreshUserDoc.mockClear();
    h.updateDoc.mockClear();
  });
  afterEach(() => cleanup());

  it('CLEARING a channel writes an explicit root null (the delete must take effect)', async () => {
    // Root-only writes + root-presence-authoritative resolution: an emptied
    // field must persist as null so the frozen nested enrollment copy stops
    // being disclosed (PR #206 review).
    h.auth.userDoc = userDoc({ contactEmail: 'old@example.com', contactPhone: '+33 600000000' });
    renderPage();
    fireEvent.change(contactEmailInput(), { target: { value: '' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toHaveProperty('contactEmail', null);
    // and no nested contact key rides along (root-only writes)
    expect(Object.keys(payload).some((k) => /^profiles\..*\.(contactEmail|contactPhone|whatsapp)$/.test(k))).toBe(false);
  });

  it('saves contact to the ROOT fields only — no nested contact keys in the payload', async () => {
    h.auth.userDoc = userDoc({ contactEmail: 'old@example.com', contactPhone: '+33 600000000' });
    renderPage();
    fireEvent.change(contactEmailInput(), { target: { value: 'new@example.com' } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/bs1' }),
        expect.objectContaining({
          contactEmail: 'new@example.com',
          contactPhone: '+33 600000000',
          updatedAt: 'ts',
        }),
      ),
    );
    const payload = (h.updateDoc.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    // contactSharingConsent legitimately stays nested (profile-scoped GDPR
    // toggle); the contact TRIO must not appear under profiles.* anymore.
    for (const key of Object.keys(payload)) {
      expect(key).not.toMatch(/^profiles\..*(contactEmail|contactPhone|whatsapp)$/);
    }
  });

  it('seeds the form from ROOT contact when present (root wins over nested)', () => {
    h.auth.userDoc = userDoc(
      { contactEmail: 'nested@example.com' },
      { contactEmail: 'root@example.com' },
    );
    renderPage();
    expect(contactEmailInput().value).toBe('root@example.com');
  });

  it('still seeds from the nested copy when the root is absent (un-backfilled doc)', () => {
    h.auth.userDoc = userDoc({ contactEmail: 'nested@example.com' });
    renderPage();
    expect(contactEmailInput().value).toBe('nested@example.com');
  });

  it('renders the EJM email from the root field when the nested copy is absent', () => {
    h.auth.userDoc = userDoc(
      { ejemEmail: undefined },
      { ejemEmail: 'noa.weiss28@ejm.org' },
    );
    renderPage();
    expect(screen.getByText('noa.weiss28@ejm.org')).toBeInTheDocument();
  });
});
