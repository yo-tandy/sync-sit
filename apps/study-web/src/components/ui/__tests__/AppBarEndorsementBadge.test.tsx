import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, within, act } from '@testing-library/react';

// Hoisted, test-controllable firestore state (RequestsPage.test.tsx shape).
// The AppBar subscribes via onSnapshot to `references` where tutorUserId==me
// and counts status 'private' client-side; the mock captures the listener so
// tests can push follow-up snapshots and drive the error path.
type Row = Record<string, unknown>;
type Snapshot = { docs: { id: string; data: () => Row }[] };
const h = vi.hoisted(() => ({
  rows: [] as Row[],
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  onSnapshot: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as null | {
    query: { query: { path: string }[] };
    next: (snap: Snapshot) => void;
    error: (err: unknown) => void;
  },
}));

vi.mock('@/config/firebase', () => ({ auth: {}, db: {}, functions: {}, storage: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  onSnapshot: (...args: unknown[]) => h.onSnapshot(...args),
}));
vi.mock('@/stores/authStore', () => {
  const state = {
    userDoc: { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' },
    firebaseUser: { uid: 't1' },
    logout: vi.fn(),
  };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { renderWithProviders } from '@/__tests__/test-utils';
import { AppBar } from '../AppBar';

function ref(id: string, status: string): Row {
  return { referenceId: id, tutorUserId: 't1', status };
}

function snapOf(rows: Row[]): Snapshot {
  return { docs: rows.map((r) => ({ id: r.referenceId as string, data: () => r })) };
}

function reset() {
  h.rows = [];
  h.where.mockClear();
  h.unsubscribe.mockClear();
  h.listener = null;
  h.onSnapshot.mockReset();
  h.onSnapshot.mockImplementation(
    (query: unknown, next: (snap: Snapshot) => void, error: (err: unknown) => void) => {
      h.listener = { query: query as { query: { path: string }[] }, next, error };
      next(snapOf(h.rows));
      return h.unsubscribe;
    },
  );
}

const endorsementsLink = () => screen.getByRole('link', { name: /endorsements/i });
const triggerDot = (button: HTMLElement) => button.querySelector('.bg-amber-400');

/**
 * Issue #196: PR #194 moved endorsements into the hamburger menu and dropped
 * the dashboard's pending count, leaving no signal that an endorsement awaits
 * Accept/Dismiss. These pins cover the restored signal: an amber count badge
 * on the Endorsements menu entry, a dot on the hamburger trigger while any
 * entry carries a badge (with a screen-reader hint in the aria-label), the
 * exact query shape (references / tutorUserId == uid / status 'private'
 * counted client-side — the EndorsementsPage read), and the silent-failure
 * contract (a rejected read renders no badge, no crash).
 */
describe('tutor AppBar pending-endorsement badge', () => {
  beforeEach(() => reset());

  it('shows the amber count on the Endorsements entry, counting only actionable (private) rows', () => {
    h.rows = [ref('e1', 'private'), ref('e2', 'private'), ref('e3', 'approved'), ref('e4', 'removed')];
    renderWithProviders(<AppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));

    const badge = within(endorsementsLink()).getByText('2');
    expect(badge.className).toMatch(/bg-amber-100/);
  });

  it('renders no badge at zero actionable rows', () => {
    h.rows = [ref('e1', 'approved'), ref('e2', 'published')];
    renderWithProviders(<AppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));

    expect(within(endorsementsLink()).queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it('shows the trigger dot iff a menu entry carries a badge, with the aria hint', () => {
    h.rows = [ref('e1', 'private')];
    renderWithProviders(<AppBar />);

    // Dot present, aria-label extended for screen readers.
    const trigger = screen.getByRole('button', { name: /open menu \(items awaiting your attention\)/i });
    expect(triggerDot(trigger)).not.toBeNull();

    // Live pin: the tutor responds elsewhere -> follow-up snapshot clears the
    // badge, the dot and the hint with it (onSnapshot, not a one-shot read).
    act(() => h.listener?.next(snapOf([ref('e1', 'approved')])));
    const cleared = screen.getByRole('button', { name: /^open menu$/i });
    expect(triggerDot(cleared)).toBeNull();
  });

  it('queries references by the tutor uid (EndorsementsPage shape) and unsubscribes on unmount', () => {
    const { unmount } = renderWithProviders(<AppBar />);

    expect(h.where).toHaveBeenCalledWith('tutorUserId', '==', 't1');
    expect(h.onSnapshot.mock.calls[0][0].query[0].path).toBe('references');

    unmount();
    expect(h.unsubscribe).toHaveBeenCalled();
  });

  it('a rejected query renders no badge, no dot and no crash', () => {
    h.rows = [ref('e1', 'private')];
    renderWithProviders(<AppBar />);
    act(() => h.listener?.error(new Error('permission-denied')));

    const trigger = screen.getByRole('button', { name: /^open menu$/i });
    expect(triggerDot(trigger)).toBeNull();
    fireEvent.click(trigger);
    expect(within(endorsementsLink()).queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it('a throwing subscription setup renders the bar without a badge', () => {
    h.onSnapshot.mockImplementation(() => {
      throw new Error('firestore unavailable');
    });
    renderWithProviders(<AppBar />);

    const trigger = screen.getByRole('button', { name: /^open menu$/i });
    expect(triggerDot(trigger)).toBeNull();
  });
});
