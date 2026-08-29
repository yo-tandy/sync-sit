import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Per-app field separation is the central claim of the study PWA work: sit
// and study are separate installs on separate origins, so study's dismissal
// must persist to `dismissedPwaInstallBannerStudy` — never sit's flat
// `dismissedPwaInstallBanner` — and read the same field back (PR #192 review).
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 'u1' } as { uid: string } | null,
    userDoc: null as unknown,
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn<(ref: { path: string }, data: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve(),
  ),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: [ref: { path: string }, data: Record<string, unknown>]) =>
    h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { InstallAppBanner } from '../InstallAppBanner';

describe('InstallAppBanner', () => {
  beforeEach(() => {
    h.auth.firebaseUser = { uid: 'u1' };
    h.auth.userDoc = { uid: 'u1' };
    h.auth.refreshUserDoc.mockClear();
    h.updateDoc.mockClear();
  });

  it('renders in browser-tab mode and links the install guide', () => {
    // jsdom has no matchMedia/standalone flags — isRunningAsPWA() is false.
    renderWithProviders(<InstallAppBanner />);
    expect(screen.getByRole('link', { name: /install/i })).toHaveAttribute('href', '/install');
  });

  it('dismissal writes the STUDY field, never sit’s flat one', async () => {
    renderWithProviders(<InstallAppBanner />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    expect(h.updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/u1' }),
      { dismissedPwaInstallBannerStudy: true, updatedAt: 'ts' },
    );
    const payload = h.updateDoc.mock.calls[0][1];
    expect(payload).not.toHaveProperty('dismissedPwaInstallBanner');
    // Optimistically hidden regardless of the write outcome.
    expect(screen.queryByRole('link', { name: /install/i })).toBeNull();
  });

  it('stays hidden when the STUDY dismissal field is set on the user doc', () => {
    h.auth.userDoc = { uid: 'u1', dismissedPwaInstallBannerStudy: true };
    renderWithProviders(<InstallAppBanner />);
    expect(screen.queryByRole('link', { name: /install/i })).toBeNull();
  });

  it('is NOT hidden by sit’s dismissal field — separate installs, separate dismissals', () => {
    h.auth.userDoc = { uid: 'u1', dismissedPwaInstallBanner: true };
    renderWithProviders(<InstallAppBanner />);
    expect(screen.getByRole('link', { name: /install/i })).toBeInTheDocument();
  });
});
