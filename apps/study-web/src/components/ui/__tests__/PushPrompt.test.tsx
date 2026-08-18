import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// PWA gating pins for the soft push prompt (issue #168 Phase 1): the prompt
// must never appear in a regular browser tab — only in installed-PWA mode.

const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 'u1' } as { uid: string } | null },
  isPushSupported: vi.fn(() => true),
  wasPrompted: vi.fn(() => false),
  markPrompted: vi.fn(),
  requestPushPermission: vi.fn(() => Promise.resolve('tok')),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

vi.mock('@/lib/pushNotifications', () => ({
  isPushSupported: () => h.isPushSupported(),
  wasPrompted: () => h.wasPrompted(),
  markPrompted: () => h.markPrompted(),
  requestPushPermission: (...args: unknown[]) => h.requestPushPermission(...args),
}));

import { PushPrompt } from '../PushPrompt';

function stubPwaMode(on: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: on && query === '(display-mode: standalone)',
  }));
}

describe('PushPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.auth.firebaseUser = { uid: 'u1' };
    h.isPushSupported.mockReturnValue(true);
    h.wasPrompted.mockReturnValue(false);
    h.markPrompted.mockClear();
    h.requestPushPermission.mockClear();
    vi.stubGlobal('Notification', { permission: 'default' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('never shows in a regular browser tab (web-app mode)', () => {
    stubPwaMode(false);
    renderWithProviders(<PushPrompt />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText(/enable notifications/i)).toBeNull();
    expect(h.requestPushPermission).not.toHaveBeenCalled();
  });

  it('shows after the delay in installed-PWA mode', () => {
    stubPwaMode(true);
    renderWithProviders(<PushPrompt />);
    expect(screen.queryByText(/enable notifications/i)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText(/enable notifications/i)).toBeInTheDocument();
  });

  it('does not show again once the user was already prompted', () => {
    stubPwaMode(true);
    h.wasPrompted.mockReturnValue(true);
    renderWithProviders(<PushPrompt />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText(/enable notifications/i)).toBeNull();
  });

  it('silently refreshes the token when permission is already granted (no prompt)', () => {
    stubPwaMode(true);
    vi.stubGlobal('Notification', { permission: 'granted' });
    renderWithProviders(<PushPrompt />);
    expect(h.requestPushPermission).toHaveBeenCalledWith('u1');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText(/enable notifications/i)).toBeNull();
  });

  it('enabling registers push for the signed-in user and marks prompted', async () => {
    stubPwaMode(true);
    renderWithProviders(<PushPrompt />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    const enable = screen.getByRole('button', { name: /^enable$/i });
    await act(async () => {
      enable.click();
    });
    expect(h.markPrompted).toHaveBeenCalled();
    expect(h.requestPushPermission).toHaveBeenCalledWith('u1');
    expect(screen.queryByText(/enable notifications/i)).toBeNull();
  });

  it('dismissing marks prompted without registering', async () => {
    stubPwaMode(true);
    renderWithProviders(<PushPrompt />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    const notNow = screen.getByRole('button', { name: /not now/i });
    await act(async () => {
      notNow.click();
    });
    expect(h.markPrompted).toHaveBeenCalled();
    expect(h.requestPushPermission).not.toHaveBeenCalled();
    expect(screen.queryByText(/enable notifications/i)).toBeNull();
  });
});
