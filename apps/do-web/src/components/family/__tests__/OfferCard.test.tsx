import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import type { OfferDoc } from '@ejm/do-core';

/**
 * Offer-card pins (plan §9.1 "the heart of the product"):
 * - renders the §4.2 denormalized doer fields, price+basis, message, and
 *   the §11.3 helper WITH its disclosure copy;
 * - endorsements: THE three status-constrained queries against the shared
 *   references collection (shape asserted verbatim — the status-in
 *   constraint is what makes them provable under the H2-hardened rule);
 * - ordering do-first, then sit/study labeled with their origin app;
 * - a doer with none renders the graceful starting-state line;
 * - accept/decline only on pending offers.
 */

const h = vi.hoisted(() => ({
  queries: [] as unknown[][],
  results: new Map<string, Record<string, unknown>[]>(),
  fail: false,
  /** Subject fields whose query should reject — models a partial outage. */
  failFields: new Set<string>(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  limit: (n: number) => ({ limit: n }),
  getDocs: (q: { query: unknown[] }) => {
    h.queries.push(q.query);
    if (h.fail) return Promise.reject(new Error('denied'));
    const field = (q.query[1] as { where: [string] }).where[0];
    if (h.failFields.has(field)) return Promise.reject(new Error('denied'));
    const rows = h.results.get(field) ?? [];
    return Promise.resolve({ docs: rows.map((r, i) => ({ id: `${field}-${i}`, data: () => r })) });
  },
}));

import { OfferCard } from '../OfferCard';

function offer(overrides: Partial<OfferDoc> = {}): OfferDoc {
  return {
    offerId: 'task1_doer1',
    taskId: 'task1',
    doerUserId: 'doer1',
    familyId: 'fam1',
    doerFirstName: 'Emma',
    doerPhotoUrl: null,
    doerBio: 'Handy with furniture',
    taskTitle: 'Assemble PAX',
    taskCategory: 'ikea',
    taskTiming: 'deadline',
    price: 45,
    priceBasis: 'flat',
    message: 'I can do this on Saturday.',
    helper: null,
    availabilityNote: null,
    status: 'pending',
    declinedReason: null,
    createdAt: {} as OfferDoc['createdAt'],
    updatedAt: {} as OfferDoc['updatedAt'],
    ...overrides,
  };
}

beforeEach(() => {
  h.queries = [];
  h.results = new Map();
  h.fail = false;
  h.failFields = new Set();
});

describe('OfferCard endorsements', () => {
  it('issues EXACTLY the three status-constrained references queries (§9.1 load-bearing shape)', async () => {
    renderWithProviders(<OfferCard offer={offer()} />);
    await waitFor(() => expect(h.queries).toHaveLength(3));
    for (const field of ['doerUserId', 'babysitterUserId', 'tutorUserId']) {
      expect(h.queries).toContainEqual([
        { path: 'references' },
        { where: [field, '==', 'doer1'] },
        // NOT optional: the H2-hardened rule grants an unrelated caller only
        // the public-status disjunct — drop this and the read is denied.
        { where: ['status', 'in', ['approved', 'published']] },
        { limit: 10 },
      ]);
    }
  });

  it('renders do-first, then sit/study labeled with their origin app', async () => {
    h.results.set('doerUserId', [
      { referenceText: 'Built our shelves perfectly', submittedByName: 'Famille A' },
    ]);
    h.results.set('babysitterUserId', [
      { referenceText: 'Great with our kids', refName: 'Famille B' },
    ]);
    h.results.set('tutorUserId', [
      { referenceText: 'Patient maths tutor', submittedByName: 'Famille C' },
    ]);
    renderWithProviders(<OfferCard offer={offer()} />);
    await waitFor(() => expect(screen.getByText(/Built our shelves/)).toBeInTheDocument());

    const texts = screen.getAllByText(/“/).map((el) => el.textContent);
    expect(texts[0]).toContain('Built our shelves');

    expect(screen.getByText('From Sync/Sit')).toBeInTheDocument();
    expect(screen.getByText('From Sync/Study')).toBeInTheDocument();
    // The sync-do endorsement carries NO origin label — it is the current
    // app's own signal.
    const doLine = screen.getByText(/Built our shelves/).closest('li')!;
    expect(doLine.textContent).not.toContain('From Sync/');
  });

  // PR11 verification: PR7 shipped this card with the do side ALWAYS empty
  // (no DoerEndorsementDoc existed yet), so the do path had only ever been
  // exercised as the zero case. This feeds a full DoerEndorsementDoc — the
  // real shape doSubmitEndorsement writes — as the ONLY source, and pins
  // that it renders, unlabeled, without the empty line.
  it('populates from a real DoerEndorsementDoc with sit and study both empty', async () => {
    h.results.set('doerUserId', [
      {
        referenceId: 'r1',
        doerUserId: 'doer1',
        appSource: 'do',
        type: 'family_submitted',
        status: 'approved',
        submittedByUserId: 'p1',
        submittedByFamilyId: 'fam1',
        submittedByName: 'Marie Dupont',
        refName: 'Marie',
        referenceText: 'Assembled the PAX in an afternoon.',
        category: 'ikea',
        isEjmFamily: true,
      },
    ]);
    renderWithProviders(<OfferCard offer={offer()} />);
    await waitFor(() =>
      expect(screen.getByText(/Assembled the PAX/)).toBeInTheDocument(),
    );
    // The empty line must be GONE — the starting state is not the steady one.
    expect(screen.queryByText(/No endorsements yet/)).toBeNull();
    // submittedByName wins over refName, and no origin label on do's own.
    expect(screen.getByText('Marie Dupont')).toBeInTheDocument();
    const line = screen.getByText(/Assembled the PAX/).closest('li')!;
    expect(line.textContent).not.toContain('From Sync/');
  });

  // Every do endorsement the family reads here is `approved`; the doer's
  // `private` and `removed` ones are excluded by the status constraint at
  // the query, not by anything this component does. Pinned so a later
  // refactor cannot start filtering client-side and quietly drop the
  // constraint that makes the read provable at all.
  it('renders whatever the status-constrained query returns, with no second client-side status filter', async () => {
    h.results.set('doerUserId', [
      { referenceText: 'Approved one', submittedByName: 'A', status: 'approved' },
      { referenceText: 'Published one', submittedByName: 'B', status: 'published' },
      // A row the real query could NEVER return. Asserting it renders reads
      // oddly on purpose — it is the only fixture that can fail if someone
      // adds a client-side `status in [approved, published]` filter, which is
      // the regression this test names. Two public-status rows alone would
      // stay green under exactly that filter (PR #352 round-1 review).
      { referenceText: 'Private one', submittedByName: 'C', status: 'private' },
    ]);
    renderWithProviders(<OfferCard offer={offer()} />);
    await waitFor(() => expect(screen.getByText(/Approved one/)).toBeInTheDocument());
    expect(screen.getByText(/Published one/)).toBeInTheDocument();
    expect(screen.getByText(/Private one/)).toBeInTheDocument();
  });

  it('renders the starting-state line for a doer with no endorsements anywhere', async () => {
    renderWithProviders(<OfferCard offer={offer()} />);
    await waitFor(() =>
      expect(screen.getByText(/No endorsements yet/)).toBeInTheDocument(),
    );
  });

  it('keeps do endorsements when only a SIBLING query fails (allSettled, not all)', async () => {
    // The error line is now reserved for a TOTAL failure: one failing
    // secondary source must not hide sync-do's own primary signal.
    h.results.set('doerUserId', [
      { referenceText: 'Built our shelves perfectly', submittedByName: 'Famille A' },
    ]);
    h.failFields = new Set(['babysitterUserId', 'tutorUserId']);
    renderWithProviders(<OfferCard offer={offer()} />);
    await waitFor(() => expect(screen.getByText(/Built our shelves/)).toBeInTheDocument());
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/From Sync\//)).not.toBeInTheDocument();
  });

  it('degrades to the error line when the queries fail, card intact', async () => {
    h.fail = true;
    renderWithProviders(<OfferCard offer={offer()} />);
    await waitFor(() =>
      expect(screen.getByText(/Endorsements could not be loaded/)).toBeInTheDocument(),
    );
    expect(screen.getByText('Emma')).toBeInTheDocument();
  });
});

describe('OfferCard rendering', () => {
  it('shows the denormalized doer fields, price+basis and message', () => {
    renderWithProviders(<OfferCard offer={offer({ priceBasis: 'hourly' })} />);
    expect(screen.getByText('Emma')).toBeInTheDocument();
    expect(screen.getByText('Handy with furniture')).toBeInTheDocument();
    expect(screen.getByText(/45 €/)).toBeInTheDocument();
    expect(screen.getByText('per hour')).toBeInTheDocument();
    expect(screen.getByText('I can do this on Saturday.')).toBeInTheDocument();
  });

  it('shows the §11.3 helper block with the disclosure copy', () => {
    renderWithProviders(
      <OfferCard offer={offer({ helper: { firstName: 'Léo', lastName: 'Petit', age: 16 } })} />,
    );
    expect(screen.getByText('Brings a helper: Léo Petit, 16')).toBeInTheDocument();
    expect(screen.getByText(/not a verified Sync member/)).toBeInTheDocument();
    expect(screen.getByText(/remains responsible/)).toBeInTheDocument();
  });

  it('wires accept/decline for pending offers and hides them on declined ones', () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const pending = offer();
    const { unmount } = renderWithProviders(
      <OfferCard offer={pending} onAccept={onAccept} onDecline={onDecline} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept offer' }));
    expect(onAccept).toHaveBeenCalledWith(pending);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(onDecline).toHaveBeenCalledWith(pending);
    unmount();

    renderWithProviders(
      <OfferCard offer={offer({ status: 'declined' })} onAccept={onAccept} onDecline={onDecline} />,
    );
    expect(screen.queryByRole('button', { name: 'Accept offer' })).toBeNull();
    // Noun-state badge, not the imperative CTA string (PR #331 round 1) —
    // and no lingering action buttons on a declined card.
    expect(screen.getByText('Declined')).toBeInTheDocument();
    expect(screen.queryByText('Decline')).toBeNull();
  });
});
