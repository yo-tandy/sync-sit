/**
 * Cross-app endorsements on the family's appointment card (issue #280).
 *
 * The shared `references` collection holds sit references, study tutor
 * endorsements and (once sync-do's PR-11 lands) doer endorsements for the SAME
 * uid. The card queries one source per product — sit's own field FIRST — and
 * labels every non-sit entry with its origin, because a Sync/Study endorsement
 * vouches for tutoring, not for babysitting.
 *
 * The query shape is pinned verbatim: the status-in constraint is what makes
 * the read provable under the H2-hardened references rule for a family that is
 * unrelated to the reference's author.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppointmentDoc, BabysitterSummary } from '@ejm/sit-core';

const h = vi.hoisted(() => ({
  queries: [] as unknown[][],
  /** Rows per `references` subject field — one query is issued per product. */
  results: new Map<string, Record<string, unknown>[]>(),
  fail: false,
  /** Subject fields whose query should reject — models a partial outage. */
  failFields: new Set<string>(),
  /** Subject fields whose query hangs until released — models slow sources. */
  hold: new Map<string, () => void>(),
}));

// Echo translation keys so label assertions name the key the card renders.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/config/firebase', () => ({ db: {}, auth: {}, functions: {}, storage: {} }));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => ({ periods: [] }) }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  limit: (n: number) => ({ limit: n }),
  doc: vi.fn(),
  onSnapshot: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  getDocs: (q: { query: unknown[] }) => {
    h.queries.push(q.query);
    if (h.fail) return Promise.reject(new Error('permission-denied'));
    const field = (q.query[1] as { where: [string] }).where[0];
    if (h.failFields.has(field)) return Promise.reject(new Error('permission-denied'));
    const rows = h.results.get(field) ?? [];
    const result = { docs: rows.map((r, i) => ({ id: `${field}-${i}`, data: () => r })) };
    if (h.hold.has(field)) {
      return new Promise((resolve) => {
        h.hold.set(field, () => resolve(result));
      });
    }
    return Promise.resolve(result);
  },
}));

import { ExpandableBabysitterCard } from '../ExpandableBabysitterCard';
import en from '@/i18n/en';
import fr from '@/i18n/fr';

const info: BabysitterSummary = {
  uid: 'bs-1',
  firstName: 'Marie',
  lastName: 'Dupont',
  name: 'Marie Dupont',
  age: 22,
  classLevel: 'L3',
};

const appointment = {
  appointmentId: 'apt-1',
  babysitterUserId: 'bs-1',
  date: '2026-07-01',
  startTime: '18:00',
  endTime: '22:00',
  status: 'confirmed',
} as AppointmentDoc;

function renderCard() {
  render(<ExpandableBabysitterCard appointment={appointment} info={info} variant="confirmed" />);
  // The header toggle is the first button; expanding triggers the load.
  fireEvent.click(screen.getAllByRole('button')[0]);
}

beforeEach(() => {
  h.queries = [];
  h.results = new Map();
  h.fail = false;
  h.failFields = new Set();
  h.hold = new Map();
});
afterEach(cleanup);

describe('ExpandableBabysitterCard cross-app endorsements (issue #280)', () => {
  // This file mocks `t` as an identity function, so the render assertions
  // below pin the key the component COMPUTES, not that it resolves — deleting
  // the locale entry would leave them green while users saw a raw dotted key.
  // Pinned directly instead, in BOTH locales (apps/web has no en/fr parity
  // test of its own). SearchPageCrossApp.test.tsx covers resolution end-to-end
  // for the same prefix under real i18n.
  it('has the origin-label copy for every app sit can label, in both locales', () => {
    for (const locale of [en, fr]) {
      const refs = locale.references as Record<string, string>;
      for (const key of ['fromStudy', 'fromDo']) {
        expect(typeof refs[key]).toBe('string');
        expect(refs[key].length).toBeGreaterThan(0);
      }
    }
  });

  it('issues one status-constrained query per product, sit first', async () => {
    renderCard();
    await waitFor(() => expect(h.queries).toHaveLength(3));
    // Fields AND their order pinned per query, sit's own field leading.
    const fields = ['babysitterUserId', 'tutorUserId', 'doerUserId'];
    h.queries.forEach((q, i) => {
      expect(q[0]).toEqual({ path: 'references' });
      expect(q[1]).toEqual({ where: [fields[i], '==', 'bs-1'] });
      // NOT optional: an unrelated family can only prove the public-status
      // disjunct of the references read rule, and only from the query.
      expect(q[2]).toEqual({ where: ['status', 'in', ['approved', 'published']] });
      expect(q[3]).toEqual({ limit: 10 });
    });
  });

  it('lists sit references first, then study endorsements labeled by origin', async () => {
    h.results.set('babysitterUserId', [
      { refName: 'Famille Garde', note: 'Sat for us for two years' },
    ]);
    h.results.set('tutorUserId', [
      { submittedByName: 'Famille Etude', referenceText: 'Patient maths tutor' },
    ]);
    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/Endorsement from Famille Garde/)).toBeInTheDocument(),
    );
    const rows = screen.getAllByRole('button').filter((b) => /Endorsement from/.test(b.textContent ?? ''));
    expect(rows[0].textContent).toContain('Famille Garde');
    expect(rows[1].textContent).toContain('Famille Etude');

    // Only the cross-app row is labeled; sit's own signal needs no origin.
    expect(rows[0].textContent).not.toContain('references.from');
    expect(rows[1].textContent).toContain('references.fromStudy');
  });

  it('shows a study-only babysitter their study endorsement, still labeled', async () => {
    h.results.set('tutorUserId', [
      { submittedByName: 'Famille Etude', referenceText: 'Patient maths tutor' },
    ]);
    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/Endorsement from Famille Etude/)).toBeInTheDocument(),
    );
    expect(screen.getByText('references.fromStudy')).toBeInTheDocument();
  });

  it('renders a sync-do endorsement labeled references.fromDo (PR-11 needs no code change here)', async () => {
    h.results.set('doerUserId', [
      { submittedByName: 'Famille Bricolage', referenceText: 'Assembled our shelves' },
    ]);
    renderCard();
    await waitFor(() =>
      expect(screen.getByText(/Endorsement from Famille Bricolage/)).toBeInTheDocument(),
    );
    expect(screen.getByText('references.fromDo')).toBeInTheDocument();
  });

  it('keeps sit references when only a SIBLING query fails (allSettled, not all)', async () => {
    h.results.set('babysitterUserId', [
      { refName: 'Famille Garde', note: 'Sat for us for two years' },
    ]);
    h.failFields = new Set(['tutorUserId', 'doerUserId']);
    renderCard();
    await waitFor(() =>
      expect(screen.getByText(/Endorsement from Famille Garde/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/references\.from/)).not.toBeInTheDocument();
  });

  it('never renders referee contact details for a cross-app entry', async () => {
    h.results.set('tutorUserId', [
      {
        submittedByName: 'Famille Etude',
        referenceText: 'Patient maths tutor',
        refEmail: 'etude@example.com',
        refPhone: '+33100000000',
      },
    ]);
    renderCard();
    const row = await screen.findByRole('button', { name: /Endorsement from Famille Etude/ });
    fireEvent.click(row);
    expect(await screen.findByText(/Patient maths tutor/)).toBeInTheDocument();
    expect(screen.queryByText(/etude@example\.com/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+33100000000/)).not.toBeInTheDocument();
  });

  it('caches a WHOLE load — re-expanding does not refetch all three sources', async () => {
    // This surface previously refetched on every expand, the most read-
    // expensive of the three at 3 queries per toggle.
    h.results.set('babysitterUserId', [{ refName: 'Famille Garde', note: 'x' }]);
    renderCard();
    await waitFor(() => expect(h.queries).toHaveLength(3));
    fireEvent.click(screen.getAllByRole('button')[0]); // collapse
    fireEvent.click(screen.getAllByRole('button')[0]); // re-expand
    await waitFor(() => expect(screen.getByText(/Famille Garde/)).toBeInTheDocument());
    expect(h.queries).toHaveLength(3);
  });

  it('retries on re-expand after a PARTIAL load — only whole loads are cached', async () => {
    h.results.set('babysitterUserId', [{ refName: 'Famille Garde', note: 'x' }]);
    h.results.set('tutorUserId', [
      { submittedByName: 'Famille Etude', referenceText: 'Patient maths tutor' },
    ]);
    h.failFields = new Set(['tutorUserId']);
    renderCard();
    await waitFor(() => expect(h.queries).toHaveLength(3));
    expect(screen.queryByText(/Famille Etude/)).not.toBeInTheDocument();

    h.failFields = new Set();
    fireEvent.click(screen.getAllByRole('button')[0]); // collapse
    fireEvent.click(screen.getAllByRole('button')[0]); // re-expand refetches
    await waitFor(() => expect(h.queries).toHaveLength(6));
    expect(await screen.findByText(/Endorsement from Famille Etude/)).toBeInTheDocument();
  });

  it('does not strand the card when a collapse races an in-flight load', async () => {
    // The bug this guards: collapse cancelled the load, the re-expand hit the
    // in-flight guard and started nothing, and the resolving load then wrote
    // nothing — leaving an expanded card with an empty list and no dep left to
    // change. The write is now gated on UID identity, not on collapse, so a
    // collapsed-then-reexpanded load still lands (and its reads are not wasted).
    h.results.set('babysitterUserId', [{ refName: 'Famille Garde', note: 'x' }]);
    h.hold.set('tutorUserId', () => {}); // this source hangs
    renderCard();
    await waitFor(() => expect(h.queries).toHaveLength(3));

    const toggle = () => fireEvent.click(screen.getAllByRole('button')[0]);
    toggle(); // collapse mid-load
    toggle(); // re-expand — deduped, starts nothing
    expect(h.queries).toHaveLength(3);

    h.hold.get('tutorUserId')!(); // the original load lands
    expect(await screen.findByText(/Endorsement from Famille Garde/)).toBeInTheDocument();

    // And it cached as complete: toggling again issues no further queries.
    toggle();
    toggle();
    await waitFor(() => expect(screen.getByText(/Famille Garde/)).toBeInTheDocument());
    expect(h.queries).toHaveLength(3);
  });

  it('keeps the card intact when the endorsement queries are denied', async () => {
    h.fail = true;
    renderCard();
    await waitFor(() => expect(h.queries).toHaveLength(3));
    expect(screen.getByText('Marie Dupont')).toBeInTheDocument();
    expect(screen.queryByText(/Endorsement from/)).not.toBeInTheDocument();
  });
});
