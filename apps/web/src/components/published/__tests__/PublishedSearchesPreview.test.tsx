import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// "Posts from families" on the babysitter dashboard (issue #207, owner
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
  id, familyName: 'Dupont', areaLabel: '16e', type: 'one_time',
  date: '2027-06-07', startTime: '19:00', endTime: '22:00', recurringSlots: null,
  schoolWeeksOnly: false, kidAges: [6], numberOfKids: 1, offeredRate: 15,
  additionalInfo: null, createdAt: ts(createdMs), expiresAt: ts(Date.now() + 864e5),
});
const renderPreview = () => render(<MemoryRouter><PublishedSearchesPreview /></MemoryRouter>);

describe('PublishedSearchesPreview', () => {
  beforeEach(() => {
    h.auth.userDoc = { uid: 'bs1', profiles: { babysitter: { enrollmentComplete: true } } };
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
  // sitter a way in — otherwise the board's own empty/error copy, and every
  // post a later refresh brings, are reachable only by typing the URL.
  it('keeps the board reachable when the board is EMPTY', () => {
    h.snapshot = (next) => next({ docs: [] });
    renderPreview();
    expect(screen.getByText('publishedBoard.previewTitle')).toBeInTheDocument();
    expect(screen.getByText('publishedBoard.previewEmpty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'publishedBoard.openBoard' }))
      .toHaveAttribute('href', '/babysitter/published-searches');
  });

  it('keeps the board reachable when the read FAILS, and says so', () => {
    h.snapshot = (_next, err) => err();
    renderPreview();
    expect(screen.getByText('publishedBoard.previewError')).toBeInTheDocument();
    expect(screen.queryByText('publishedBoard.previewEmpty')).toBeNull();
    expect(screen.getByRole('link', { name: 'publishedBoard.openBoard' }))
      .toHaveAttribute('href', '/babysitter/published-searches');
  });

  it('lists posts under the section title with a link to the full board', () => {
    h.snapshot = (next) => next({ docs: [{ data: () => post('p1', 1000) }] });
    renderPreview();
    expect(screen.getByText('publishedBoard.previewTitle')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'publishedBoard.seeMore' }))
      .toHaveAttribute('href', '/babysitter/published-searches');
  });

  it('tags a post New against the stored seenAt; equality is not New', () => {
    h.snapshot = (next) => next({ docs: [{ data: () => post('p1', 5000) }] });
    const unseen = renderPreview();
    expect(screen.getAllByText('publishedBoard.newTag').length).toBeGreaterThan(0);
    unseen.unmount();
    cleanup();

    h.auth.userDoc = {
      uid: 'bs1',
      profiles: { babysitter: { enrollmentComplete: true, publishedSearchesSeenAt: ts(5000) } },
    };
    renderPreview();
    expect(screen.queryByText('publishedBoard.newTag')).toBeNull();
  });

  it('asks for at most THREE posts — the dashboard is a preview, not the board', () => {
    h.snapshot = (next) => next({ docs: [] });
    renderPreview();
    expect(h.lastLimit).toBe(3);
  });
});
