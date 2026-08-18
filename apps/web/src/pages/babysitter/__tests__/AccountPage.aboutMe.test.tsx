import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';

// About-me pins for the sit babysitter account page (issue #171): the bio
// editor moved here from the Babysitting Options page, matching the study
// tutor AccountPage (seed-once, trimmed save, empty -> null).
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

function userDoc(babysitterOverrides: Record<string, unknown> = {}) {
  return {
    uid: 'bs1',
    email: 'noa28@ejm.org',
    firstName: 'Noa',
    lastName: 'Weiss',
    profiles: {
      babysitter: { enrollmentComplete: true, searchable: true, ...babysitterOverrides },
    },
    notifPrefs: {},
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

const aboutMeBox = () =>
  screen.getByRole('textbox', { name: /about me & experience/i }) as HTMLTextAreaElement;

describe('BabysitterAccountPage about me', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
    h.auth.userDoc = userDoc();
    h.auth.refreshUserDoc.mockClear();
    h.updateDoc.mockClear();
  });
  afterEach(() => cleanup());

  it('renders the stored bio seeded into the textarea, bounded at 1000 chars', () => {
    h.auth.userDoc = userDoc({ aboutMe: 'I love kids and board games.' });
    renderPage();

    const box = aboutMeBox();
    expect(box.value).toBe('I love kids and board games.');
    // UX-only bound mirroring study's tutor editor (sit rules carry no server bound).
    expect(box.maxLength).toBe(1000);
  });

  it('save writes the trimmed bio to profiles.babysitter.aboutMe', async () => {
    h.auth.userDoc = userDoc({ aboutMe: 'Old bio' });
    renderPage();

    fireEvent.change(aboutMeBox(), { target: { value: '  New bio, new me.  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/bs1' }),
        {
          'profiles.babysitter.aboutMe': 'New bio, new me.',
          updatedAt: 'ts',
        },
      ),
    );
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('clearing the bio saves null (not an empty string)', async () => {
    h.auth.userDoc = userDoc({ aboutMe: 'Old bio' });
    renderPage();

    fireEvent.change(aboutMeBox(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/bs1' }),
        {
          'profiles.babysitter.aboutMe': null,
          updatedAt: 'ts',
        },
      ),
    );
  });

  it('a userDoc refresh does not clobber a typed-but-unsaved bio (seed-once)', () => {
    h.auth.userDoc = userDoc({ aboutMe: 'Old bio' });
    const { rerender } = renderPage();

    fireEvent.change(aboutMeBox(), { target: { value: 'Typed but unsaved' } });

    // Simulate the photo auto-save's refreshUserDoc() landing a fresh doc.
    h.auth.userDoc = userDoc({ aboutMe: 'Old bio' });
    rerender(
      <ToastProvider>
        <MemoryRouter>
          <BabysitterAccountPage />
        </MemoryRouter>
      </ToastProvider>,
    );

    expect(aboutMeBox().value).toBe('Typed but unsaved');
  });
});
