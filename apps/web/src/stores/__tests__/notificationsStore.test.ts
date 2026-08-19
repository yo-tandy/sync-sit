import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared notifications store (issue #127, UX F13). The store keeps ONE
// module-level onSnapshot listener per uid; the mock captures each listener so
// tests can push snapshots and the error path directly.
const h = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  unsubscribe: vi.fn(),
  listeners: [] as {
    query: { query: unknown[] };
    next: (snap: unknown) => void;
    error: (err: unknown) => void;
  }[],
  updateDoc: vi.fn(),
  batchUpdate: vi.fn(),
  batchCommit: vi.fn(),
  where: vi.fn((...args: [string, string, unknown]) => ({ where: args })),
  orderBy: vi.fn((...args: [string, string]) => ({ orderBy: args })),
  limit: vi.fn((n: number) => ({ limit: n })),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));
// The hook goes through useAuthStore; these tests drive watchNotifications
// directly, so a null-user stub keeps the authStore side effects out.
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ firebaseUser: null }) }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  orderBy: (...args: [string, string]) => h.orderBy(...args),
  limit: (n: number) => h.limit(n),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  onSnapshot: (...args: unknown[]) => h.onSnapshot(...args),
  writeBatch: () => ({ update: h.batchUpdate, commit: h.batchCommit }),
}));

import { watchNotifications, useNotificationsStore } from '../notificationsStore';

function ts(seconds: number) {
  return { seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) };
}

function notifDoc(id: string, type: string, read = false, data: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      recipientUserId: 'u1',
      type,
      title: `Title ${id}`,
      body: `Body ${id}`,
      data,
      read,
      channels: ['push'],
      emailSent: false,
      pushSent: false,
      createdAt: ts(1_700_000_000),
    }),
  };
}

function snapOf(docs: ReturnType<typeof notifDoc>[]) {
  return { docs };
}

function reset() {
  // Detach whatever a previous test left watching BEFORE clearing the spies,
  // so the detach call doesn't count against the next test.
  watchNotifications(null);
  h.onSnapshot.mockReset();
  h.unsubscribe.mockClear();
  h.updateDoc.mockReset();
  h.updateDoc.mockResolvedValue(undefined);
  h.batchUpdate.mockReset();
  h.batchCommit.mockReset();
  h.batchCommit.mockResolvedValue(undefined);
  h.where.mockClear();
  h.orderBy.mockClear();
  h.limit.mockClear();
  h.onSnapshot.mockImplementation(
    (
      query: { query: unknown[] },
      next: (snap: unknown) => void,
      error: (err: unknown) => void,
    ) => {
      h.listeners.push({ query, next, error });
      return h.unsubscribe;
    },
  );
  h.listeners = [];
}

describe('notificationsStore (sit)', () => {
  beforeEach(() => reset());

  it('subscribes recipient-only, ordered newest-first, limited to 50', () => {
    watchNotifications('u1');
    expect(h.onSnapshot).toHaveBeenCalledTimes(1);
    const collectionArg = (h.listeners[0].query.query[0] as { path: string }).path;
    expect(collectionArg).toBe('notifications');
    expect(h.where).toHaveBeenCalledWith('recipientUserId', '==', 'u1');
    expect(h.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(h.limit).toHaveBeenCalledWith(50);
  });

  it('lists only sit-visible types and counts unread among them (study-only types never light the bell)', () => {
    watchNotifications('u1');
    h.listeners[0].next(
      snapOf([
        notifDoc('a', 'new_request', false),
        // Study-world type: must NOT be listed nor counted in sit.
        notifDoc('b', 'study_session_cancelled', false),
        notifDoc('c', 'tutor_endorsement_received', false),
        // Guardian type: visible in BOTH apps.
        notifDoc('d', 'supervision_request', false),
        // Read row: listed but not counted.
        notifDoc('e', 'reminder', true),
      ]),
    );
    const s = useNotificationsStore.getState();
    expect(s.notifications?.map((n) => n.id)).toEqual(['a', 'd', 'e']);
    expect(s.unreadCount).toBe(2);
    expect(s.loadError).toBe(false);
  });

  it('zero state: empty snapshot yields an empty list and count 0', () => {
    watchNotifications('u1');
    h.listeners[0].next(snapOf([]));
    const s = useNotificationsStore.getState();
    expect(s.notifications).toEqual([]);
    expect(s.unreadCount).toBe(0);
  });

  it('subscription error: count 0, null list, loadError set', () => {
    watchNotifications('u1');
    h.listeners[0].error(new Error('permission-denied'));
    const s = useNotificationsStore.getState();
    expect(s.notifications).toBeNull();
    expect(s.unreadCount).toBe(0);
    expect(s.loadError).toBe(true);
  });

  it('markRead writes ONLY { read: true } to the tapped doc and drops the count', async () => {
    watchNotifications('u1');
    h.listeners[0].next(snapOf([notifDoc('a', 'new_request', false)]));
    await useNotificationsStore.getState().markRead('a');
    expect(h.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = h.updateDoc.mock.calls[0] as [{ path: string }, unknown];
    expect(ref.path).toBe('notifications/a');
    // The rules-pinned payload shape: the read key and NOTHING else.
    expect(payload).toEqual({ read: true });
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
    expect(useNotificationsStore.getState().notifications?.[0].read).toBe(true);
  });

  it('markRead on an already-read row writes nothing', async () => {
    watchNotifications('u1');
    h.listeners[0].next(snapOf([notifDoc('a', 'new_request', true)]));
    await useNotificationsStore.getState().markRead('a');
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('markAllRead batches { read: true } for exactly the unread visible docs', async () => {
    watchNotifications('u1');
    h.listeners[0].next(
      snapOf([
        notifDoc('a', 'new_request', false),
        notifDoc('b', 'reminder', true),
        notifDoc('c', 'supervision_request', false),
      ]),
    );
    await useNotificationsStore.getState().markAllRead();
    expect(h.batchUpdate).toHaveBeenCalledTimes(2);
    const updated = h.batchUpdate.mock.calls.map((c) => (c[0] as { path: string }).path);
    expect(updated).toEqual(['notifications/a', 'notifications/c']);
    for (const call of h.batchUpdate.mock.calls) {
      expect(call[1]).toEqual({ read: true });
    }
    expect(h.batchCommit).toHaveBeenCalledTimes(1);
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
  });

  it('a synchronous subscribe failure degrades to the error posture instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.onSnapshot.mockImplementation(() => {
      throw new Error('bad app instance');
    });
    expect(() => watchNotifications('u1')).not.toThrow();
    const s = useNotificationsStore.getState();
    expect(s.notifications).toBeNull();
    expect(s.unreadCount).toBe(0);
    expect(s.loadError).toBe(true);
    warn.mockRestore();
  });

  it('keeps a single subscription per uid and detaches on sign-out', () => {
    watchNotifications('u1');
    watchNotifications('u1');
    expect(h.onSnapshot).toHaveBeenCalledTimes(1);
    watchNotifications(null);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    const s = useNotificationsStore.getState();
    expect(s.notifications).toBeNull();
    expect(s.unreadCount).toBe(0);
  });
});
