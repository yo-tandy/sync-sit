import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * Published-searches board for babysitters (issue #207, PR2). Pins:
 * - New tagging boundary: createdAt == seenAt is NOT New (strict >), later
 *   is; a never-visited sitter sees everything New.
 * - Mount-captured threshold: tags do NOT flip when the seen-write updates
 *   the live userDoc.
 * - Expiry filtered client-side; empty board copy; error copy.
 * - The visit writes EXACTLY {'profiles.babysitter.publishedSearchesSeenAt':
 *   serverTimestamp()} on users/{uid}, once, and NOT on an errored read.
 * - PR3's Contact CTA: the dialog calls contactPublishedSearch with the card's
 *   id (and the trimmed message only when non-empty), a live appointment for a
 *   search replaces its button with "Request sent", and a declined prior
 *   contact does NOT (the server allows the retry).
 */

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const SEEN_AT = NOW - 10_000;
const SERVER_TS = { __serverTimestamp: true };

const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  snapshotNext: null as null | ((snap: unknown) => void),
  snapshotError: null as null | ((err: unknown) => void),
  aptNext: null as null | ((snap: unknown) => void),
  updateDoc: vi.fn(() => Promise.resolve()),
  callable: vi.fn(() => Promise.resolve({ data: { appointmentId: 'apt-1' } })),
  unsub: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  limit: (n: number) => ({ limit: n }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
  onSnapshot: (_q: unknown, next: (snap: unknown) => void, error: (err: unknown) => void) => {
    // The page subscribes to the board first, then to the sitter's own
    // appointments (the "already contacted" set).
    if (h.snapshotNext === null) {
      h.snapshotNext = next;
      h.snapshotError = error;
    } else {
      h.aptNext = next;
    }
    return h.unsub;
  },
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import '@/i18n';
import { PublishedSearchesPage } from '../PublishedSearchesPage';

function sitterDoc(seenAtMs: number | null) {
  return {
    uid: 'bs1',
    firstName: 'Lea',
    profiles: {
      babysitter: {
        ejemEmail: 'lea@ejm.org',
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
    app: 'sit',
    familyId: 'famX',
    familyName: 'Dupont',
    areaLabel: '16e',
    type: 'one_time',
    date: '2026-08-25',
    startTime: '18:00',
    endTime: '22:00',
    recurringSlots: null,
    schoolWeeksOnly: false,
    kidAges: [6, 4],
    numberOfKids: 2,
    offeredRate: 15,
    additionalInfo: null,
    createdAt: { toMillis: () => createdAtMs },
    expiresAt: { toMillis: () => NOW + DAY_MS, toDate: () => new Date(NOW + DAY_MS) },
    ...overrides,
  };
}

function push(rows: Row[]) {
  act(() => h.snapshotNext!({ docs: rows.map((r) => ({ id: r.id as string, data: () => r })) }));
}

/** The sitter's own appointments, as the contacted-set subscription sees them. */
function pushAppointments(rows: Row[]) {
  act(() => h.aptNext!({ docs: rows.map((r) => ({ data: () => r })) }));
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PublishedSearchesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.snapshotNext = null;
  h.snapshotError = null;
  h.aptNext = null;
  h.auth.userDoc = sitterDoc(SEEN_AT);
});

afterEach(cleanup);

describe('PublishedSearchesPage (sit board)', () => {
  it('tags strictly-newer docs New; createdAt == seenAt is NOT New (boundary pin)', async () => {
    renderPage();
    push([
      boardDoc('newer', SEEN_AT + 1, { familyName: 'Newer' }),
      boardDoc('boundary', SEEN_AT, { familyName: 'Boundary' }),
      boardDoc('older', SEEN_AT - 1, { familyName: 'Older' }),
    ]);
    await waitFor(() => expect(screen.getByText('Newer family')).toBeInTheDocument());
    expect(screen.getAllByText('New')).toHaveLength(1);
  });

  it('shows everything as New for a never-visited sitter', async () => {
    h.auth.userDoc = sitterDoc(null);
    renderPage();
    push([boardDoc('a', NOW - 5000), boardDoc('b', NOW - 4000, { familyName: 'Martin' })]);
    await waitFor(() => expect(screen.getAllByText('New')).toHaveLength(2));
  });

  it('keeps tags stable when the live userDoc seenAt updates mid-visit (mount capture)', async () => {
    const { rerender } = renderPage();
    push([boardDoc('a', SEEN_AT + 1)]);
    await waitFor(() => expect(screen.getAllByText('New')).toHaveLength(1));
    // Simulate the seen-write landing on the live userDoc subscription.
    h.auth.userDoc = sitterDoc(NOW);
    rerender(
      <MemoryRouter>
        <PublishedSearchesPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('New')).toHaveLength(1);
  });

  it('renders a RECURRING post as day names plus times, with the school-weeks line', async () => {
    // Every other pin uses a one_time doc, so the recurring branch of the
    // card's schedule builder — day-name lookup, the joined slots, and the
    // schoolWeeksOnly line — was never exercised (PR #211 review).
    renderPage();
    push([
      boardDoc('r', SEEN_AT + 1, {
        type: 'recurring',
        date: null,
        startTime: null,
        endTime: null,
        schoolWeeksOnly: true,
        recurringSlots: [
          { day: 'mon', startTime: '17:00', endTime: '19:00' },
          { day: 'thu', startTime: '18:00', endTime: '20:30' },
        ],
      }),
    ]);
    await waitFor(() =>
      expect(
        screen.getByText('Mondays 17:00–19:00, Thursdays 18:00–20:30'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('School weeks only')).toBeInTheDocument();
  });

  it('filters expired docs client-side and renders the empty state on an empty board', async () => {
    renderPage();
    push([
      boardDoc('expired', SEEN_AT + 1, {
        expiresAt: { toMillis: () => NOW - 1000, toDate: () => new Date(NOW - 1000) },
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByText(/No published searches right now/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Dupont family')).toBeNull();
  });

  it('marks the visit with the EXACT seenAt payload, once, after a successful snapshot', async () => {
    renderPage();
    expect(h.updateDoc).not.toHaveBeenCalled(); // not before the snapshot
    push([boardDoc('a', SEEN_AT + 1)]);
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalledTimes(1));
    expect(h.updateDoc).toHaveBeenCalledWith(
      { path: 'users/bs1' },
      { 'profiles.babysitter.publishedSearchesSeenAt': SERVER_TS },
    );
    // A follow-up snapshot must not write again.
    push([boardDoc('a', SEEN_AT + 1), boardDoc('b', SEEN_AT + 2)]);
    await waitFor(() => expect(screen.getAllByText('New')).toHaveLength(2));
    expect(h.updateDoc).toHaveBeenCalledTimes(1);
  });

  it('renders the error copy and does NOT consume the New tags on a failed read', async () => {
    renderPage();
    act(() => h.snapshotError!(new Error('denied')));
    await waitFor(() =>
      expect(screen.getByText(/Could not load published searches/)).toBeInTheDocument(),
    );
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('sends the contact through contactPublishedSearch with the card id and trimmed message', async () => {
    renderPage();
    push([boardDoc('ps-1', SEEN_AT + 1)]);
    await waitFor(() => expect(screen.getByText('Contact family')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Contact family'));
    fireEvent.change(screen.getByLabelText('Message (optional)'), {
      target: { value: '  I am free that evening  ' },
    });
    fireEvent.click(screen.getByText('Send request'));

    await waitFor(() => expect(h.callable).toHaveBeenCalledTimes(1));
    expect(h.callable).toHaveBeenCalledWith('contactPublishedSearch', {
      publishedSearchId: 'ps-1',
      message: 'I am free that evening',
    });
  });

  it('omits an empty message rather than sending a blank one', async () => {
    renderPage();
    push([boardDoc('ps-1', SEEN_AT + 1)]);
    await waitFor(() => expect(screen.getByText('Contact family')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Contact family'));
    fireEvent.click(screen.getByText('Send request'));

    await waitFor(() => expect(h.callable).toHaveBeenCalledTimes(1));
    expect(h.callable).toHaveBeenCalledWith('contactPublishedSearch', { publishedSearchId: 'ps-1' });
  });

  it('shows the error copy and keeps the dialog open when the call fails', async () => {
    h.callable.mockRejectedValueOnce(new Error('failed-precondition'));
    renderPage();
    push([boardDoc('ps-1', SEEN_AT + 1)]);
    await waitFor(() => expect(screen.getByText('Contact family')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Contact family'));
    fireEvent.click(screen.getByText('Send request'));

    await waitFor(() =>
      expect(screen.getByText(/Could not send your request/)).toBeInTheDocument(),
    );
  });

  it('replaces the CTA with "Request sent" for a search with a LIVE appointment only', async () => {
    renderPage();
    push([
      boardDoc('ps-live', SEEN_AT + 1, { familyName: 'Live' }),
      boardDoc('ps-declined', SEEN_AT + 1, { familyName: 'Declined' }),
    ]);
    await waitFor(() => expect(screen.getAllByText('Contact family')).toHaveLength(2));

    pushAppointments([
      { publishedSearchId: 'ps-live', status: 'pending' },
      // A declined prior contact must NOT consume the CTA: the server lets
      // the sitter try again.
      { publishedSearchId: 'ps-declined', status: 'rejected' },
    ]);

    await waitFor(() => expect(screen.getByText('Request sent')).toBeInTheDocument());
    expect(screen.getAllByText('Contact family')).toHaveLength(1);
  });
});
