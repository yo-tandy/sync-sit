import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * Published-searches board for tutors (issue #207, PR2). Pins mirror the sit
 * board suite:
 * - New boundary: createdAt == seenAt is NOT New (strict >); never-visited
 *   sees everything New; mount-captured threshold stays stable.
 * - Expiry filtered client-side; empty board; error copy.
 * - The visit writes EXACTLY {'profiles.tutor.publishedSearchesSeenAt':
 *   serverTimestamp()} on users/{uid}, once, and NOT on an errored read.
 * - No contact button — the contact-soon note instead (PR4 ships the CTA).
 */

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const SEEN_AT = NOW - 10_000;
const SERVER_TS = { __serverTimestamp: true };

const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  snapshotNext: null as null | ((snap: unknown) => void),
  snapshotError: null as null | ((err: unknown) => void),
  updateDoc: vi.fn(() => Promise.resolve()),
  unsub: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  limit: (n: number) => ({ limit: n }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
  onSnapshot: (_q: unknown, next: (snap: unknown) => void, error: (err: unknown) => void) => {
    h.snapshotNext = next;
    h.snapshotError = error;
    return h.unsub;
  },
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { PublishedSearchesPage } from '../PublishedSearchesPage';

function tutorDoc(seenAtMs: number | null) {
  return {
    uid: 't1',
    firstName: 'Alex',
    profiles: {
      tutor: {
        ejemEmail: 'alex@ejm.org',
        enrollmentComplete: true,
        ...(seenAtMs !== null
          ? { publishedSearchesSeenAt: { toMillis: () => seenAtMs, toDate: () => new Date(seenAtMs) } }
          : {}),
      },
    },
  };
}

type Row = Record<string, unknown>;
function boardDoc(id: string, createdAtMs: number, overrides: Row = {}): Row {
  return {
    id,
    app: 'study',
    familyId: 'famX',
    familyName: 'Dupont',
    areaLabel: '16e',
    subject: 'math',
    level: '6e',
    locationPrefs: ['online'],
    maxRate: 30,
    createdAt: { toMillis: () => createdAtMs },
    expiresAt: { toMillis: () => NOW + DAY_MS, toDate: () => new Date(NOW + DAY_MS) },
    ...overrides,
  };
}

function push(rows: Row[]) {
  act(() => h.snapshotNext!({ docs: rows.map((r) => ({ id: r.id as string, data: () => r })) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.snapshotNext = null;
  h.snapshotError = null;
  h.auth.userDoc = tutorDoc(SEEN_AT);
});

describe('PublishedSearchesPage (study board)', () => {
  it('tags strictly-newer docs New; createdAt == seenAt is NOT New (boundary pin)', async () => {
    renderWithProviders(<PublishedSearchesPage />);
    push([
      boardDoc('newer', SEEN_AT + 1, { subject: 'physics' }),
      boardDoc('boundary', SEEN_AT),
      boardDoc('older', SEEN_AT - 1, { subject: 'english' }),
    ]);
    await waitFor(() => expect(screen.getByText('Physics (6e)')).toBeInTheDocument());
    expect(screen.getAllByText('New')).toHaveLength(1);
  });

  it('shows everything as New for a never-visited tutor', async () => {
    h.auth.userDoc = tutorDoc(null);
    renderWithProviders(<PublishedSearchesPage />);
    push([boardDoc('a', NOW - 5000), boardDoc('b', NOW - 4000, { subject: 'physics' })]);
    await waitFor(() => expect(screen.getAllByText('New')).toHaveLength(2));
  });

  it('filters expired docs client-side and renders the empty state on an empty board', async () => {
    renderWithProviders(<PublishedSearchesPage />);
    push([
      boardDoc('expired', SEEN_AT + 1, {
        expiresAt: { toMillis: () => NOW - 1000, toDate: () => new Date(NOW - 1000) },
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByText(/No published searches right now/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Mathematics (6e)')).toBeNull();
  });

  it('marks the visit with the EXACT seenAt payload, once, after a successful snapshot', async () => {
    renderWithProviders(<PublishedSearchesPage />);
    expect(h.updateDoc).not.toHaveBeenCalled();
    push([boardDoc('a', SEEN_AT + 1)]);
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalledTimes(1));
    expect(h.updateDoc).toHaveBeenCalledWith(
      { path: 'users/t1' },
      { 'profiles.tutor.publishedSearchesSeenAt': SERVER_TS },
    );
    push([boardDoc('a', SEEN_AT + 1), boardDoc('b', SEEN_AT + 2, { subject: 'physics' })]);
    await waitFor(() => expect(screen.getAllByText('New')).toHaveLength(2));
    expect(h.updateDoc).toHaveBeenCalledTimes(1);
  });

  it('renders the error copy and does NOT consume the New tags on a failed read', async () => {
    renderWithProviders(<PublishedSearchesPage />);
    act(() => h.snapshotError!(new Error('denied')));
    await waitFor(() =>
      expect(screen.getByText(/Could not load published searches/)).toBeInTheDocument(),
    );
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('offers no contact button — only the contact-soon note (PR4 ships the CTA)', async () => {
    renderWithProviders(<PublishedSearchesPage />);
    push([boardDoc('a', SEEN_AT + 1)]);
    await waitFor(() =>
      expect(screen.getByText('Contacting families arrives in the next update')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /contact/i })).toBeNull();
    // The only button on the page is TopNav's back control.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
