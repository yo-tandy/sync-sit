import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// "Posts from families" on the tutor dashboard (issue #207, owner
// direction on PR #211): the board's entry point moved here from the menu,
// so these pins replace the old menu-badge spec.
const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  snapshot: null as null | ((next: (s: unknown) => void, err: () => void) => void),
  lastLimit: 0,
}));

vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: (...a: unknown[]) => ({ q: a }),
  where: (...a: unknown[]) => ({ where: a }),
  orderBy: (...a: unknown[]) => ({ orderBy: a }),
  limit: (n: number) => { h.lastLimit = n; return { limit: n }; },
  onSnapshot: (_q: unknown, next: (s: unknown) => void, err: () => void) => {
    h.snapshot?.(next, err);
    return () => {};
  },
}));

import { PublishedSearchesPreview } from '../PublishedSearchesPreview';

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const post = (id: string, createdMs: number) => ({
  id, familyName: 'Dupont', areaLabel: '16e', subject: 'math', level: '6e',
  locationPrefs: ['online'], maxRate: 25,
  createdAt: ts(createdMs), expiresAt: ts(Date.now() + 864e5),
});
const renderPreview = () => render(<MemoryRouter><PublishedSearchesPreview /></MemoryRouter>);

describe('PublishedSearchesPreview', () => {
  beforeEach(() => {
    // status + enrollmentComplete mirror the rules predicate the preview
    // gates on; without both the section renders nothing at all.
    h.auth.userDoc = { uid: 't1', status: 'active', profiles: { tutor: { enrollmentComplete: true } } };
    h.snapshot = null;
    h.lastLimit = 0;
    cleanup();
  });

  it('renders nothing while the FIRST SNAPSHOT is pending (no flash before the cards)', () => {
    const { container } = renderPreview();
    expect(container).toBeEmptyDOMElement();
  });

  // This section is the only link to the board now that the menu entries are
  // gone (PR #211 review), so an empty or failed read must still leave the
  // tutor a way in — otherwise the board's own empty/error copy, and every
  // post a later refresh brings, are reachable only by typing the URL.
  it('keeps the board reachable when the board is EMPTY', () => {
    h.snapshot = (next) => next({ docs: [] });
    renderPreview();
    expect(screen.getByText('tutor.publishedBoard.previewTitle')).toBeInTheDocument();
    expect(screen.getByText('tutor.publishedBoard.previewEmpty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'tutor.publishedBoard.openBoard' }))
      .toHaveAttribute('href', '/tutor/published-searches');
  });

  it('keeps the board reachable when the read FAILS, and says so', () => {
    h.snapshot = (_next, err) => err();
    renderPreview();
    expect(screen.getByText('tutor.publishedBoard.previewError')).toBeInTheDocument();
    expect(screen.queryByText('tutor.publishedBoard.previewEmpty')).toBeNull();
    expect(screen.getByRole('link', { name: 'tutor.publishedBoard.openBoard' }))
      .toHaveAttribute('href', '/tutor/published-searches');
  });

  it('renders nothing for a provider the rules can never grant the read to', () => {
    // Same predicate as firestore.rules; without it these accounts get a
    // permanent error line and a link into a board they cannot read
    // (PR #211 review).
    h.snapshot = (_next, err) => err();
    h.auth.userDoc = { uid: 't1', status: 'active', profiles: { tutor: {} } };
    const incomplete = renderPreview();
    expect(incomplete.container).toBeEmptyDOMElement();
    incomplete.unmount();
    cleanup();

    h.auth.userDoc = {
      uid: 't1', status: 'suspended',
      profiles: { tutor: { enrollmentComplete: true } },
    };
    const inactive = renderPreview();
    expect(inactive.container).toBeEmptyDOMElement();
  });

  it('over-fetches so expired docs at the head cannot starve the preview', () => {
    // The expiry filter runs client-side, AFTER the server-side limit: asking
    // for exactly 3 lets 3 expired-but-unswept docs hide every active post
    // (PR #211 review). The query asks for more and the hook slices after.
    const expired = { ...post('x', 9000), expiresAt: ts(Date.now() - 864e5) };
    h.snapshot = (next) => next({
      docs: [
        { data: () => expired }, { data: () => expired }, { data: () => expired },
        { data: () => post('live', 1000) },
      ],
    });
    renderPreview();
    expect(h.lastLimit).toBeGreaterThan(3);
    expect(screen.getByText('tutor.publishedBoard.familyTitle')).toBeInTheDocument();
    expect(screen.queryByText('tutor.publishedBoard.previewEmpty')).toBeNull();
  });

  it('lists posts under the section title with a link to the full board', () => {
    h.snapshot = (next) => next({ docs: [{ data: () => post('p1', 1000) }] });
    renderPreview();
    expect(screen.getByText('tutor.publishedBoard.previewTitle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'tutor.publishedBoard.seeMore' }))
      .toHaveAttribute('href', '/tutor/published-searches');
  });

  it('tags a post New against the stored seenAt; equality is not New', () => {
    h.snapshot = (next) => next({ docs: [{ data: () => post('p1', 5000) }] });
    const unseen = renderPreview();
    expect(screen.getAllByText('tutor.publishedBoard.newTag').length).toBeGreaterThan(0);
    unseen.unmount();
    cleanup();

    h.auth.userDoc = {
      uid: 't1',
      status: 'active',
      profiles: { tutor: { enrollmentComplete: true, publishedSearchesSeenAt: ts(5000) } },
    };
    renderPreview();
    expect(screen.queryByText('tutor.publishedBoard.newTag')).toBeNull();
  });

  it('RENDERS at most three posts — the dashboard is a preview, not the board', () => {
    // The query over-fetches (see the expiry pin above), so the bound that
    // matters is what reaches the screen, not what the query asked for.
    h.snapshot = (next) => next({
      docs: [1, 2, 3, 4, 5].map((n) => ({ data: () => post(`p${n}`, 1000 + n) })),
    });
    renderPreview();
    expect(screen.getAllByText('tutor.publishedBoard.familyTitle')).toHaveLength(3);
  });
});
