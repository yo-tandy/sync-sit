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
    const rows = h.results.get(field) ?? [];
    return Promise.resolve({ docs: rows.map((r, i) => ({ id: `${field}-${i}`, data: () => r })) });
  },
}));

import { ExpandableBabysitterCard } from '../ExpandableBabysitterCard';

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
});
afterEach(cleanup);

describe('ExpandableBabysitterCard cross-app endorsements (issue #280)', () => {
  it('issues one status-constrained query per product, sit first', async () => {
    renderCard();
    await waitFor(() => expect(h.queries).toHaveLength(3));
    expect(h.queries.map((q) => (q[1] as { where: [string] }).where[0])).toEqual([
      'babysitterUserId',
      'tutorUserId',
      'doerUserId',
    ]);
    for (const q of h.queries) {
      expect(q[0]).toEqual({ path: 'references' });
      // NOT optional: an unrelated family can only prove the public-status
      // disjunct of the references read rule, and only from the query.
      expect(q[2]).toEqual({ where: ['status', 'in', ['approved', 'published']] });
      expect(q[3]).toEqual({ limit: 10 });
    }
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

  it('keeps the card intact when the endorsement queries are denied', async () => {
    h.fail = true;
    renderCard();
    await waitFor(() => expect(h.queries).toHaveLength(3));
    expect(screen.getByText('Marie Dupont')).toBeInTheDocument();
    expect(screen.queryByText(/Endorsement from/)).not.toBeInTheDocument();
  });
});
