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
    h.auth.userDoc = { uid: 't1', profiles: { tutor: { enrollmentComplete: true } } };
    h.snapshot = null;
    h.lastLimit = 0;
    cleanup();
  });

  it('renders NOTHING when the board is empty (no dead section on the dashboard)', () => {
    h.snapshot = (next) => next({ docs: [] });
    const { container } = renderPreview();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the first snapshot is pending, and on a failed read', () => {
    const pending = renderPreview();
    expect(pending.container).toBeEmptyDOMElement();
    pending.unmount();

    h.snapshot = (_next, err) => err();
    const failed = renderPreview();
    expect(failed.container).toBeEmptyDOMElement();
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
      profiles: { tutor: { enrollmentComplete: true, publishedSearchesSeenAt: ts(5000) } },
    };
    renderPreview();
    expect(screen.queryByText('tutor.publishedBoard.newTag')).toBeNull();
  });

  it('asks for at most THREE posts — the dashboard is a preview, not the board', () => {
    h.snapshot = (next) => next({ docs: [] });
    renderPreview();
    expect(h.lastLimit).toBe(3);
  });
});
