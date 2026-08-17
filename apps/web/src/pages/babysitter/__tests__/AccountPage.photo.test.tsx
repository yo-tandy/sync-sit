import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';

// Photo lifecycle pins for the sit babysitter account page — the same
// mechanism the study tutor page carries (PR #145 round 6 gave sit the
// object-deletion behavior; these pins mirror the study suite's).
const h = vi.hoisted(() => ({
  auth: {
    userDoc: null as Record<string, unknown> | null,
    firebaseUser: { uid: 'bs1' },
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn(() => Promise.resolve()),
  uploadBytes: vi.fn(() => Promise.resolve()),
  getDownloadURL: vi.fn(() => Promise.resolve('https://firebasestorage.example/new.jpg')),
  deleteObject: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ path }),
  uploadBytes: (...args: unknown[]) => h.uploadBytes(...args),
  getDownloadURL: (...args: unknown[]) => h.getDownloadURL(...args),
  deleteObject: (...args: unknown[]) => h.deleteObject(...args),
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

function userDoc(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'bs1',
    email: 'noa28@ejm.org',
    firstName: 'Noa',
    lastName: 'Weiss',
    profiles: { babysitter: { enrollmentComplete: true, searchable: true } },
    notifPrefs: {},
    ...overrides,
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

describe('BabysitterAccountPage photo lifecycle', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
    h.auth.userDoc = userDoc();
    h.auth.refreshUserDoc.mockClear();
    h.updateDoc.mockClear();
    h.uploadBytes.mockClear();
    h.deleteObject.mockClear();
  });
  afterEach(() => cleanup());

  it('uploads to a lowercase-normalized uid-keyed path', async () => {
    renderPage();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'IMG.JPG', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(h.uploadBytes).toHaveBeenCalled());
    expect((h.uploadBytes.mock.calls[0][0] as { path: string }).path).toBe(
      'profile-photos/bs1.jpg',
    );
  });

  it('replacing under a different path deletes the old object (no readable orphans)', async () => {
    h.auth.userDoc = userDoc({
      photoUrl: 'https://firebasestorage.example/v0/b/x/o/profile-photos%2Fbs1.JPG?alt=media',
    });
    renderPage();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })] },
    });

    await waitFor(() =>
      expect(h.deleteObject).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'profile-photos/bs1.JPG' }),
      ),
    );
  });

  it('remove nulls photoUrl and deletes the storage object', async () => {
    h.auth.userDoc = userDoc({
      photoUrl: 'https://firebasestorage.example/v0/b/x/o/profile-photos%2Fbs1.jpg?alt=media',
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /remove photo/i }));
    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/bs1' }),
        expect.objectContaining({ photoUrl: null, updatedAt: 'ts' }),
      ),
    );
    await waitFor(() =>
      expect(h.deleteObject).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'profile-photos/bs1.jpg' }),
      ),
    );
  });

  it('a failed removal shows an error instead of a silent no-op', async () => {
    h.auth.userDoc = userDoc({ photoUrl: 'https://firebasestorage.example/old.jpg' });
    h.updateDoc.mockRejectedValueOnce(new Error('offline'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /remove photo/i }));
    expect(await screen.findByText(/could not remove the photo/i)).toBeInTheDocument();
    expect(h.deleteObject).not.toHaveBeenCalled();
  });
});
