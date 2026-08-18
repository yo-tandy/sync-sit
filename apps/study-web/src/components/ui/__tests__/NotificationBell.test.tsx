import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Bell badge (issue #127, UX F13). The unread-count DERIVATION (visible-type
// filtering) is pinned in notificationsStore.test.ts; this suite pins the
// presentation: badge only when count > 0, capped display, aria names, and
// the link target. Auth is signed-out so the hook's watch call is a no-op and
// the store state can be preset directly.
vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ firebaseUser: null }) }));

import { NotificationBell } from '../NotificationBell';
import { useNotificationsStore } from '@/stores/notificationsStore';

describe('NotificationBell', () => {
  beforeEach(() => {
    useNotificationsStore.setState({ notifications: null, unreadCount: 0, loadError: false });
  });

  it('shows no badge at zero and keeps the plain aria name', () => {
    renderWithProviders(<NotificationBell to="/tutor/notifications" />);
    const link = screen.getByRole('link', { name: 'Notifications' });
    expect(link).toHaveAttribute('href', '/tutor/notifications');
    expect(link.textContent).toBe('');
  });

  it('badges the unread count with an unread-aware aria name', () => {
    useNotificationsStore.setState({ unreadCount: 3 });
    renderWithProviders(<NotificationBell to="/family/notifications" />);
    const link = screen.getByRole('link', { name: 'Notifications, 3 unread' });
    expect(link).toHaveAttribute('href', '/family/notifications');
    expect(link).toHaveTextContent('3');
  });

  it('caps the displayed count at 9+', () => {
    useNotificationsStore.setState({ unreadCount: 12 });
    renderWithProviders(<NotificationBell to="/tutor/notifications" />);
    expect(screen.getByRole('link', { name: 'Notifications, 12 unread' })).toHaveTextContent('9+');
  });

  it('is a 44px hit target (WCAG 2.5.8)', () => {
    renderWithProviders(<NotificationBell to="/tutor/notifications" />);
    expect(screen.getByRole('link', { name: 'Notifications' }).className).toMatch(
      /\bh-11\b[\s\S]*\bw-11\b|\bw-11\b[\s\S]*\bh-11\b/,
    );
  });
});
