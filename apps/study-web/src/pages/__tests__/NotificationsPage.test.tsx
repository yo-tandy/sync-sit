import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// /notifications page (issue #127, UX F13), tested against the REAL shared
// store: the firestore mock captures the single onSnapshot listener so tests
// deliver snapshots/errors, and taps are asserted down to the updateDoc
// payload ({ read: true } and nothing else — rules-pinned).
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 'u1' } as { uid: string } | null,
    userDoc: null as Record<string, unknown> | null,
  },
  navigate: vi.fn(),
  onSnapshot: vi.fn(),
  unsubscribe: vi.fn(),
  listeners: [] as { next: (snap: unknown) => void; error: (err: unknown) => void }[],
  updateDoc: vi.fn(),
  batchUpdate: vi.fn(),
  batchCommit: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => ({ where: args }),
  orderBy: (...args: [string, string]) => ({ orderBy: args }),
  limit: (n: number) => ({ limit: n }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  onSnapshot: (...args: unknown[]) => h.onSnapshot(...args),
  writeBatch: () => ({ update: h.batchUpdate, commit: h.batchCommit }),
}));

vi.mock('react-router', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router')>();
  return { ...orig, useNavigate: () => h.navigate };
});

import { NotificationsPage } from '../NotificationsPage';
import { watchNotifications } from '@/stores/notificationsStore';

const TUTOR_DOC = { profiles: { tutor: { subjects: [] } } };
const PARENT_DOC = { profiles: { parent: { familyId: 'fam1' } } };

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

function renderPage(rows: ReturnType<typeof notifDoc>[] | 'error') {
  h.onSnapshot.mockImplementation(
    (
      _query: unknown,
      next: (snap: unknown) => void,
      error: (err: unknown) => void,
    ) => {
      h.listeners.push({ next, error });
      if (rows === 'error') {
        error(new Error('permission-denied'));
      } else {
        next({ docs: rows });
      }
      return h.unsubscribe;
    },
  );
  return renderWithProviders(<NotificationsPage />);
}

function reset() {
  watchNotifications(null);
  h.auth.firebaseUser = { uid: 'u1' };
  h.auth.userDoc = TUTOR_DOC;
  h.navigate.mockClear();
  h.onSnapshot.mockReset();
  h.unsubscribe.mockClear();
  h.listeners = [];
  h.updateDoc.mockReset();
  h.updateDoc.mockResolvedValue(undefined);
  h.batchUpdate.mockReset();
  h.batchCommit.mockReset();
  h.batchCommit.mockResolvedValue(undefined);
}

describe('NotificationsPage (study)', () => {
  beforeEach(() => reset());

  it('tap on a routed type writes ONLY { read: true } and navigates per the map', async () => {
    renderPage([notifDoc('a', 'study_contact_request', false)]);
    fireEvent.click(await screen.findByText('Title a'));

    expect(h.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = h.updateDoc.mock.calls[0] as [{ path: string }, unknown];
    expect(ref.path).toBe('notifications/a');
    expect(payload).toEqual({ read: true });
    expect(h.navigate).toHaveBeenCalledWith('/tutor/requests');
  });

  it('routes session types by role', async () => {
    renderPage([notifDoc('a', 'study_session_cancelled', false)]);
    fireEvent.click(await screen.findByText('Title a'));
    expect(h.navigate).toHaveBeenCalledWith('/tutor/sessions');
  });

  it('tap on an unrouted type marks read without navigating', async () => {
    renderPage([notifDoc('a', 'guardian_action', false)]);
    fireEvent.click(await screen.findByText('Title a'));

    expect(h.updateDoc).toHaveBeenCalledTimes(1);
    expect(h.updateDoc.mock.calls[0][1]).toEqual({ read: true });
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('routes by role: a guardian type lands the parent on governance', async () => {
    h.auth.userDoc = PARENT_DOC;
    renderPage([notifDoc('a', 'guardian_mirror', false, { mirroredFrom: 'kid1' })]);
    fireEvent.click(await screen.findByText('Title a'));
    expect(h.navigate).toHaveBeenCalledWith('/family/governance/kid1');
  });

  it('tap on an already-read row navigates without writing', async () => {
    h.auth.userDoc = PARENT_DOC;
    renderPage([notifDoc('a', 'study_session_proposed', true)]);
    fireEvent.click(await screen.findByText('Title a'));
    expect(h.updateDoc).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith('/family/sessions');
  });

  it('mark all read batches { read: true } for exactly the unread rows', async () => {
    renderPage([
      notifDoc('a', 'study_session_request', false),
      notifDoc('b', 'study_session_confirmed', true),
      notifDoc('c', 'supervision_request', false),
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));

    expect(h.batchUpdate).toHaveBeenCalledTimes(2);
    const updated = h.batchUpdate.mock.calls.map((c) => (c[0] as { path: string }).path);
    expect(updated).toEqual(['notifications/a', 'notifications/c']);
    for (const call of h.batchUpdate.mock.calls) {
      expect(call[1]).toEqual({ read: true });
    }
    expect(h.batchCommit).toHaveBeenCalledTimes(1);
    // All read now: the button disappears.
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument();
  });

  it('filters to study-visible types (a sit-only notification never shows here)', async () => {
    renderPage([
      notifDoc('a', 'study_contact_request', false),
      notifDoc('b', 'new_request', false),
    ]);
    await screen.findByText('Title a');
    expect(screen.queryByText('Title b')).not.toBeInTheDocument();
  });

  it('zero state shows the empty line', async () => {
    renderPage([]);
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
  });

  it('subscription error shows the loadError line and never crashes the layout', async () => {
    renderPage('error');
    expect(
      await screen.findByText('Could not load notifications. Please try again later.'),
    ).toBeInTheDocument();
  });
});
