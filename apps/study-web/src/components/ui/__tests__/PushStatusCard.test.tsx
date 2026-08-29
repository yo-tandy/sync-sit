import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

const h = vi.hoisted(() => ({
  getPushPermissionStatus: vi.fn(() => 'default' as NotificationPermission),
  requestPushPermission: vi.fn<(userId: string) => Promise<string | null>>(() =>
    Promise.resolve<string | null>('tok'),
  ),
}));

vi.mock('@/lib/pushNotifications', () => ({
  getPushPermissionStatus: () => h.getPushPermissionStatus(),
  requestPushPermission: (...args: [userId: string]) => h.requestPushPermission(...args),
}));

import { PushStatusCard } from '../PushStatusCard';

describe('PushStatusCard', () => {
  beforeEach(() => {
    h.getPushPermissionStatus.mockReset().mockReturnValue('default');
    h.requestPushPermission.mockReset().mockResolvedValue('tok');
    vi.stubGlobal('Notification', { permission: 'default' });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('offers Enable when permission was never asked, and flips to enabled on grant', async () => {
    renderWithProviders(<PushStatusCard uid="u1" />);
    fireEvent.click(screen.getByRole('button', { name: /enable/i }));
    await waitFor(() => expect(h.requestPushPermission).toHaveBeenCalledWith('u1'));
    expect(await screen.findByText(/are enabled on this device/i)).toBeInTheDocument();
  });

  it('shows the denied guidance with a retry when permission is blocked', () => {
    h.getPushPermissionStatus.mockReturnValue('denied');
    renderWithProviders(<PushStatusCard uid="u1" />);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('does not request permission without a uid', async () => {
    renderWithProviders(<PushStatusCard />);
    fireEvent.click(screen.getByRole('button', { name: /enable/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.requestPushPermission).not.toHaveBeenCalled();
  });
});
