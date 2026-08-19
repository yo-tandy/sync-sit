import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';

/**
 * Published-searches menu badge on the sit AppBar (issue #207 — the #198
 * menu-badge idiom ported from sync-study). Pins: the amber count badge on
 * the board menu entry counts ACTIVE docs newer than the sitter's LIVE
 * publishedSearchesSeenAt (seen and expired docs excluded); the hamburger
 * trigger carries a dot + the pending aria-label while any entry has a
 * badge; zero/new-free and errored reads hide the badge (silent-failure
 * contract); non-babysitter roles never subscribe.
 */

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const SEEN_AT = NOW - 10_000;

const h = vi.hoisted(() => ({
  auth: {
    userDoc: null as unknown,
    logout: vi.fn(),
  },
  onSnapshot: vi.fn(),
  listener: null as null | { next: (snap: unknown) => void; error: (err: unknown) => void },
  unsub: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  limit: (n: number) => ({ limit: n }),
  onSnapshot: (...args: unknown[]) => h.onSnapshot(...args),
}));
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => h.auth;
  useAuthStore.getState = () => h.auth;
  return { useAuthStore: useAuthStore as unknown };
});

import i18n from '@/i18n';
import { AppBar } from '../AppBar';

function sitterDoc(seenAtMs: number | null) {
  return {
    uid: 'bs1',
    firstName: 'Lea',
    lastName: 'B',
    email: 'lea@x.com',
    profiles: {
      babysitter: {
        ejemEmail: 'lea@ejm.org',
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

function push(rows: Row[]) {
  act(() => h.listener!.next({ docs: rows.map((r, i) => ({ id: `d${i}`, data: () => r })) }));
}

function renderBar(role: 'babysitter' | 'parent' = 'babysitter') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AppBar role={role} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const trigger = () => screen.getByRole('button', { name: /open menu/i });
const triggerDot = () => trigger().querySelector('.bg-amber-400');

beforeEach(() => {
  vi.clearAllMocks();
  h.listener = null;
  h.auth.userDoc = sitterDoc(SEEN_AT);
  h.onSnapshot.mockImplementation(
    (_q: unknown, next: (snap: unknown) => void, error: (err: unknown) => void) => {
      h.listener = { next, error };
      return h.unsub;
    },
  );
});

afterEach(cleanup);

describe('sit AppBar published-searches badge', () => {
  it('counts only active docs newer than seenAt on the menu entry, with the trigger dot + aria hint', () => {
    renderBar();
    push([
      boardDoc(SEEN_AT + 1), // new + active → counts
      boardDoc(SEEN_AT), // boundary: seen → excluded
      boardDoc(SEEN_AT + 2, NOW - 1000), // new but EXPIRED → excluded
    ]);
    expect(screen.getByRole('button', { name: 'Open menu (new items pending)' })).toBeInTheDocument();
    expect(triggerDot()).not.toBeNull();

    fireEvent.click(trigger());
    const entry = screen.getByRole('link', { name: /published searches/i });
    expect(entry).toHaveTextContent('Published searches1');
  });

  it('shows no badge and the plain aria-label when nothing is new', () => {
    renderBar();
    push([boardDoc(SEEN_AT - 1)]);
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
    expect(triggerDot()).toBeNull();

    fireEvent.click(trigger());
    expect(screen.getByRole('link', { name: /published searches/i })).toHaveTextContent(/^Published searches$/);
  });

  it('clears the badge live when the seen-write lands on userDoc (no remount)', () => {
    const { rerender } = renderBar();
    push([boardDoc(SEEN_AT + 1)]);
    expect(triggerDot()).not.toBeNull();

    h.auth.userDoc = sitterDoc(NOW); // the board visit wrote seenAt
    rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AppBar role="babysitter" />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(triggerDot()).toBeNull();
  });

  it('hides the badge silently on a failed read', () => {
    renderBar();
    push([boardDoc(SEEN_AT + 1)]);
    expect(triggerDot()).not.toBeNull();
    act(() => h.listener!.error(new Error('denied')));
    expect(triggerDot()).toBeNull();
  });

  it('never subscribes for non-babysitter roles', () => {
    renderBar('parent');
    expect(h.onSnapshot).not.toHaveBeenCalled();
  });
});
