import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Supervised-account indicator: renders iff the user doc carries the
// server-owned governedBy mirror, and links the transparency page.
const h = vi.hoisted(() => ({
  auth: {
    userDoc: null as Record<string, unknown> | null,
    firebaseUser: { uid: 'kid1' },
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  updateDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: () => 'ts',
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(() => Promise.resolve()),
  getDownloadURL: vi.fn(() => Promise.resolve('https://example.com/p.jpg')),
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
    uid: 'kid1',
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
    <MemoryRouter>
      <BabysitterAccountPage />
    </MemoryRouter>,
  );
}

describe('BabysitterAccountPage supervised indicator', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
    h.auth.userDoc = userDoc();
  });
  afterEach(() => cleanup());

  it('renders no indicator without governedBy', () => {
    renderPage();
    expect(screen.queryByText(/supervised account/i)).not.toBeInTheDocument();
  });

  it('renders the indicator linking /supervision-info when governedBy is set', () => {
    h.auth.userDoc = userDoc({ governedBy: { familyId: 'fam1', linkedAt: 'ts' } });
    renderPage();

    expect(screen.getByText(/supervised account/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /what supervision means/i })).toHaveAttribute(
      'href',
      '/supervision-info',
    );
  });
});
