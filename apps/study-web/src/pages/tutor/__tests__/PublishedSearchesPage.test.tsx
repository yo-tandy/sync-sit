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
  requestsNext: null as null | ((snap: unknown) => void),
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
  // Two subscriptions now live on this page — the board itself and the
  // tutor's own contact requests (which decides "Request sent") — so the mock
  // routes by collection instead of keeping one pair of callbacks.
  onSnapshot: (q: unknown, next: (snap: unknown) => void, error: (err: unknown) => void) => {
    const path = (q as { query?: { path?: string }[] }).query?.[0]?.path;
    if (path === 'studyContactRequests') {
      h.requestsNext = next;
      // Deliver an empty set immediately: with no live request every card
      // shows its CTA, which is what most pins assume.
      next({ docs: [] });
      return h.unsub;
    }
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
  h.requestsNext = null;
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

  it('keeps tags stable when the live userDoc seenAt updates mid-visit (mount capture)', async () => {
    // The seen-write lands on the SAME userDoc subscription this page reads,
    // so without the mount capture a tutor's tags would vanish out from under
    // them while they are still reading the board. Sit pins this; study must
    // too, since both boards depend on the identical design (PR #211 review).
    const { rerender } = renderWithProviders(<PublishedSearchesPage />);
    push([boardDoc('a', SEEN_AT + 1)]);
    await waitFor(() => expect(screen.getAllByText('New')).toHaveLength(1));
    h.auth.userDoc = tutorDoc(NOW);
    rerender(<PublishedSearchesPage />);
    expect(screen.getAllByText('New')).toHaveLength(1);
  });

  it('renders location preferences from the TUTOR\'s side, not the family\'s', async () => {
    // family.search.location.* says "At your home" meaning the FAMILY's home;
    // reusing it here inverted every label for the reader (PR #211 review).
    renderWithProviders(<PublishedSearchesPage />);
    push([boardDoc('a', SEEN_AT + 1, { locationPrefs: ['family_home', 'tutor_home'] })]);
    await waitFor(() =>
      expect(screen.getByText("At the family's home, At your home")).toBeInTheDocument(),
    );
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

  it('offers a Contact CTA on a card with no live request', async () => {
    renderWithProviders(<PublishedSearchesPage />);
    push([boardDoc('a', SEEN_AT + 1)]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Contact family' })).toBeInTheDocument(),
    );
  });

  it('swaps the CTA for "Request sent" once a LIVE request exists for that search', async () => {
    // Live means pending or accepted; the set is read from the tutor's own
    // requests, so it survives a reload and a second device.
    renderWithProviders(<PublishedSearchesPage />);
    push([boardDoc('a', SEEN_AT + 1)]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Contact family' })).toBeInTheDocument());

    act(() => h.requestsNext!({
      docs: [{ data: () => ({ publishedSearchId: 'a', status: 'pending' }) }],
    }));
    await waitFor(() => expect(screen.getByText('Request sent')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Contact family' })).toBeNull();
  });

  it('a DECLINED prior request leaves the CTA available (the server owns the cooldown)', async () => {
    renderWithProviders(<PublishedSearchesPage />);
    push([boardDoc('a', SEEN_AT + 1)]);
    act(() => h.requestsNext!({
      docs: [{ data: () => ({ publishedSearchId: 'a', status: 'declined' }) }],
    }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Contact family' })).toBeInTheDocument(),
    );
    expect(screen.queryByText('Request sent')).toBeNull();
  });
});
