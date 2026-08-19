import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';

/**
 * Published-searches menu badge on the study (tutor) AppBar (issue #207 —
 * the same #198 idiom as the endorsement badge beside it). The AppBar now
 * holds TWO board-independent subscriptions (references + publishedSearches);
 * the mock routes snapshots by collection path. Pins: the amber count badge
 * on the board entry counts ACTIVE docs newer than the tutor's LIVE
 * publishedSearchesSeenAt (boundary and expired docs excluded); the trigger
 * dot appears when EITHER badge source is non-zero; errored reads hide the
 * board badge without touching the endorsement one.
 */

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const SEEN_AT = NOW - 10_000;

type Listener = { next: (snap: unknown) => void; error: (err: unknown) => void };
const h = vi.hoisted(() => ({
  auth: {
    userDoc: null as unknown,
    firebaseUser: { uid: 't1' },
    logout: vi.fn(),
  },
  listeners: {} as Record<string, Listener>,
  unsub: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ auth: {}, db: {}, functions: {}, storage: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  limit: (n: number) => ({ limit: n }),
  onSnapshot: (
    q: { query: { path?: string }[] },
    next: (snap: unknown) => void,
    error: (err: unknown) => void,
  ) => {
    const path = q.query[0]?.path ?? 'unknown';
    h.listeners[path] = { next, error };
    return h.unsub;
  },
}));
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => h.auth;
  useAuthStore.getState = () => h.auth;
  return { useAuthStore: useAuthStore as unknown };
});

import { renderWithProviders } from '@/__tests__/test-utils';
import { AppBar } from '../AppBar';

function tutorDoc(seenAtMs: number | null) {
  return {
    uid: 't1',
    firstName: 'Alex',
    lastName: 'R',
    email: 'alex@x.com',
    profiles: {
      tutor: {
        ejemEmail: 'alex@ejm.org',
        enrollmentComplete: true,
        ...(seenAtMs !== null ? { publishedSearchesSeenAt: { toMillis: () => seenAtMs } } : {}),
      },
    },
  };
}

type Row = Record<string, unknown>;
function boardDoc(createdAtMs: number, expiresAtMs = NOW + DAY_MS): Row {
  return {
    createdAt: { toMillis: () => createdAtMs },
    expiresAt: { toMillis: () => expiresAtMs },
  };
}

function pushBoard(rows: Row[]) {
  act(() =>
    h.listeners['publishedSearches'].next({
      docs: rows.map((r, i) => ({ id: `d${i}`, data: () => r })),
    }),
  );
}

function pushReferences(rows: Row[]) {
  act(() =>
    h.listeners['references'].next({
      docs: rows.map((r, i) => ({ id: `r${i}`, data: () => r })),
    }),
  );
}

const trigger = () => screen.getByRole('button', { name: /open menu/i });
const triggerDot = () => trigger().querySelector('.bg-amber-400');

beforeEach(() => {
  vi.clearAllMocks();
  h.listeners = {};
  h.auth.userDoc = tutorDoc(SEEN_AT);
});

describe('study AppBar published-searches badge', () => {
  it('counts only active docs newer than seenAt; boundary and expired excluded', () => {
    renderWithProviders(<AppBar />);
    pushReferences([]);
    pushBoard([
      boardDoc(SEEN_AT + 1), // new + active → counts
      boardDoc(SEEN_AT), // boundary: seen → excluded
      boardDoc(SEEN_AT + 2, NOW - 1000), // new but EXPIRED → excluded
    ]);
    expect(triggerDot()).not.toBeNull();

    fireEvent.click(trigger());
    const entry = screen.getByRole('link', { name: /published searches/i });
    expect(entry).toHaveTextContent('Published searches1');
  });

  it('shows no board badge (and no dot) when nothing is new and no endorsements pend', () => {
    renderWithProviders(<AppBar />);
    pushReferences([]);
    pushBoard([boardDoc(SEEN_AT - 1)]);
    expect(triggerDot()).toBeNull();

    fireEvent.click(trigger());
    expect(screen.getByRole('link', { name: /published searches/i })).toHaveTextContent(/^Published searches$/);
  });

  it('keeps the trigger dot when only the endorsement badge is non-zero (either-source dot)', () => {
    renderWithProviders(<AppBar />);
    pushReferences([{ referenceId: 'r1', tutorUserId: 't1', status: 'private' }]);
    pushBoard([boardDoc(SEEN_AT - 1)]);
    expect(triggerDot()).not.toBeNull();
  });

  it('hides the board badge silently on a failed read without touching the endorsement badge', () => {
    renderWithProviders(<AppBar />);
    pushReferences([{ referenceId: 'r1', tutorUserId: 't1', status: 'private' }]);
    pushBoard([boardDoc(SEEN_AT + 1)]);
    act(() => h.listeners['publishedSearches'].error(new Error('denied')));

    fireEvent.click(trigger());
    expect(screen.getByRole('link', { name: /published searches/i })).toHaveTextContent(/^Published searches$/);
    // The endorsement badge (count 1) still renders on its own entry.
    expect(screen.getByRole('link', { name: /endorsements/i })).toHaveTextContent(/1$/);
  });
});
