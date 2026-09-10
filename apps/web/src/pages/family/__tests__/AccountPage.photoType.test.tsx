import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';

// Issue #452: the photo picker used to gate on an ALLOWLIST of File.type,
// which rejected real photos whenever a browser reported an empty or
// application/octet-stream type -- iPhone HEIC especially. These pins prove
// the shared denylist (isAcceptablePhotoType) actually reaches this page.
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
  uploadBytes: vi.fn<(ref: { path: string }, data: unknown, metadata?: unknown) => Promise<void>>(
    () => Promise.resolve(),
  ),
  getDownloadURL: vi.fn<(ref: { path: string }) => Promise<string>>(() =>
    Promise.resolve('https://example.com/photo.jpg'),
  ),
}));

vi.mock('@/config/firebase', () => ({ db: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: [ref: { path: string }, data: Record<string, unknown>]) =>
    h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ path }),
  uploadBytes: (...args: [ref: { path: string }, data: unknown, metadata?: unknown]) =>
    h.uploadBytes(...args),
  getDownloadURL: (...args: [ref: { path: string }]) => h.getDownloadURL(...args),
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
  h.uploadBytes.mockClear();
  h.auth.refreshUserDoc.mockClear();
}

function fileInput() {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('family AccountPage photo type handling (#452)', () => {
  beforeEach(() => reset());
  afterEach(() => cleanup());

  it('accepts a File with an empty type (common for HEIC on iPhone) and uploads it', async () => {
    renderPage();
    const file = new File(['x'], 'IMG_0001.HEIC', { type: '' });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    await waitFor(() => expect(h.uploadBytes).toHaveBeenCalled());
    expect(
      screen.queryByText(i18n.t('account.photoInvalidType')),
    ).not.toBeInTheDocument();
  });

  it('accepts a File reported as application/octet-stream and uploads it', async () => {
    renderPage();
    const file = new File(['x'], 'photo.jpg', { type: 'application/octet-stream' });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    await waitFor(() => expect(h.uploadBytes).toHaveBeenCalled());
    expect(
      screen.queryByText(i18n.t('account.photoInvalidType')),
    ).not.toBeInTheDocument();
  });

  it('still rejects image/svg+xml as a scriptable, non-photo type', async () => {
    renderPage();
    const file = new File(['<svg/>'], 'picture.svg', { type: 'image/svg+xml' });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    expect(await screen.findByText(i18n.t('account.photoInvalidType'))).toBeInTheDocument();
    expect(h.uploadBytes).not.toHaveBeenCalled();
  });

  it('uploads an empty-type HEIC with an explicit image/heic contentType, not octet-stream', async () => {
    renderPage();
    const file = new File(['x'], 'IMG_0001.HEIC', { type: '' });
    fireEvent.change(fileInput(), { target: { files: [file] } });

    await waitFor(() => expect(h.uploadBytes).toHaveBeenCalled());
    const metadata = h.uploadBytes.mock.calls[0][2] as { contentType?: string } | undefined;
    expect(metadata?.contentType).toBe('image/heic');
  });
});
