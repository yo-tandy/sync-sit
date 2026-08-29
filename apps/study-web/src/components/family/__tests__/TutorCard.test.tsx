import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import type { TutorSearchResult } from '@ejm/study-core';

// Hoisted, test-controllable state. TutorCard lazily reads approved endorsements
// from the shared `references` collection (getDocs) and sends contact requests
// through the sendTutorContactRequest callable (httpsCallable).
const h = vi.hoisted(() => ({
  where: vi.fn((field: string, op: string, val: unknown) => ({ field, op, val })),
  limit: vi.fn((n: number) => ({ limit: n })),
  getDocs: vi.fn(),
  queries: [] as unknown[][],
  /** Rows per `references` subject field — the card issues one query per app. */
  results: new Map<string, Record<string, unknown>[]>(),
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  limit: (n: number) => h.limit(n),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

import { TutorCard } from '../TutorCard';

function tutor(overrides: Partial<TutorSearchResult> = {}): TutorSearchResult {
  return {
    uid: 't1',
    firstName: 'Alex',
    lastName: 'Roy',
    languages: ['fr'],
    classLevel: 'Terminale',
    subject: 'math',
    level: '6e',
    rate: 25,
    levels: ['6e'],
    sessionLengthsMin: [60],
    locationPrefs: ['online'],
    distance: 3.4,
    endorsementCount: 2,
    cancellationNoticeHours: 0,
    requestStatus: 'none',
    ...overrides,
  };
}

function reset() {
  h.where.mockClear();
  h.limit.mockClear();
  h.queries = [];
  h.results = new Map();
  h.getDocs.mockReset();
  // Field-aware: the card issues ONE query per product, so a single shared
  // doc list would triple every endorsement.
  h.getDocs.mockImplementation((q: { query: unknown[] }) => {
    h.queries.push(q.query);
    const field = (q.query[1] as { field: string }).field;
    const rows = h.results.get(field) ?? [];
    return Promise.resolve({ docs: rows.map((r, i) => ({ id: `${field}-${i}`, data: () => r })) });
  });
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { requestId: 'r1' } });
}

describe('TutorCard', () => {
  beforeEach(() => reset());

  // ── Name presentation (parity D2, issue #240) ──
  it('renders the name in the shared French form, not raw title case', () => {
    // Sit's cards have always printed "Lea BERNARD"; study printed
    // "Camille Moreau". The surname carries the caps so the two apps' result
    // cards read identically.
    renderWithProviders(<TutorCard result={tutor()} />);
    expect(screen.getByText('Alex ROY')).toBeInTheDocument();
    expect(screen.queryByText('Alex Roy')).not.toBeInTheDocument();
  });

  // ── Photo (issue #143) ──
  it('renders the tutor photo when photoUrl is present', () => {
    renderWithProviders(<TutorCard result={tutor({ photoUrl: 'https://cdn.example/t1.png' })} />);
    const img = screen.getByRole('img', { name: 'AR' });
    expect(img).toHaveAttribute('src', 'https://cdn.example/t1.png');
    // The initials block is replaced by the image.
    expect(screen.queryByText('AR')).not.toBeInTheDocument();
  });

  it('falls back to initials when photoUrl is absent', () => {
    renderWithProviders(<TutorCard result={tutor()} />);
    expect(screen.getByText('AR')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  // ── CTA states ──
  it('requestStatus=none → shows "Request contact" and no contact block', () => {
    renderWithProviders(<TutorCard result={tutor({ requestStatus: 'none' })} />);
    expect(screen.getByRole('button', { name: /request contact/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /@/ })).not.toBeInTheDocument();
  });

  it('requestStatus=pending → shows a disabled "Request pending"', () => {
    renderWithProviders(<TutorCard result={tutor({ requestStatus: 'pending' })} />);
    const btn = screen.getByRole('button', { name: /request pending/i });
    expect(btn).toBeDisabled();
  });

  it('requestStatus=accepted → shows mailto/tel/wa.me contact links', () => {
    renderWithProviders(
      <TutorCard
        result={tutor({
          requestStatus: 'accepted',
          contactEmail: 'alex@ejm.org',
          contactPhone: '+33100000000',
          whatsapp: '+33100000000',
        })}
      />,
    );
    expect(screen.getByRole('link', { name: /alex@ejm\.org/i })).toHaveAttribute(
      'href',
      'mailto:alex@ejm.org',
    );
    expect(screen.getByRole('link', { name: /\+33100000000/ })).toHaveAttribute(
      'href',
      'tel:+33100000000',
    );
    const wa = screen.getByRole('link', { name: /whatsapp/i });
    expect(wa).toHaveAttribute('href', 'https://wa.me/33100000000');
  });

  it('requestStatus=incoming → links to the requests page instead of a send CTA', () => {
    // THEY contacted US (issue #207 PR4). Offering "Request contact" here
    // would hand the family a button sendTutorContactRequest rejects as
    // already-exists (PR #213 review).
    renderWithProviders(<TutorCard result={tutor({ requestStatus: 'incoming' })} />);
    expect(screen.getByRole('link', { name: /they contacted you/i })).toHaveAttribute(
      'href',
      '/family/requests',
    );
    expect(screen.queryByRole('button', { name: /request contact/i })).not.toBeInTheDocument();
  });

  it('requestStatus=declined → shows "Request again"', () => {
    renderWithProviders(<TutorCard result={tutor({ requestStatus: 'declined' })} />);
    expect(screen.getByRole('button', { name: /request again/i })).toBeInTheDocument();
  });

  // ── Negative: no contact leakage before acceptance ──
  it('does NOT render contact fields when requestStatus != accepted (even if projected)', () => {
    renderWithProviders(
      <TutorCard result={tutor({ requestStatus: 'none', contactEmail: 'leak@ejm.org' })} />,
    );
    expect(screen.queryByText(/leak@ejm\.org/)).not.toBeInTheDocument();
  });

  // ── Dialog payload ──
  it('sends a trimmed message in the sendTutorContactRequest payload', async () => {
    renderWithProviders(<TutorCard result={tutor()} />);
    fireEvent.click(screen.getByRole('button', { name: /request contact/i }));
    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: '  hi there  ' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('sendTutorContactRequest', {
        tutorUserId: 't1',
        subject: 'math',
        level: '6e',
        message: 'hi there',
      }),
    );
  });

  it('omits message from the payload when the textarea is empty/whitespace', async () => {
    renderWithProviders(<TutorCard result={tutor()} />);
    fireEvent.click(screen.getByRole('button', { name: /request contact/i }));
    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(h.callable).toHaveBeenCalled());
    const payload = h.callable.mock.calls[0][1];
    expect(payload).not.toHaveProperty('message');
  });

  // ── Local pending flip on success ──
  it('flips the CTA to pending after a successful send', async () => {
    renderWithProviders(<TutorCard result={tutor()} />);
    fireEvent.click(screen.getByRole('button', { name: /request contact/i }));
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByRole('button', { name: /request pending/i })).toBeDisabled();
  });

  // ── Error mapping ──
  it.each([
    ['functions/already-exists', /already have a pending request/i],
    ['functions/resource-exhausted', /recently declined/i],
    ['functions/failed-precondition', /no longer available/i],
  ])('maps %s to its own message', async (code, matcher) => {
    h.callable.mockRejectedValue({ code });
    renderWithProviders(<TutorCard result={tutor()} />);
    fireEvent.click(screen.getByRole('button', { name: /request contact/i }));
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText(matcher)).toBeInTheDocument();
  });

  // ── Cancellation policy line (V2 feature 7) ──
  it('renders no bare unit and no trailing separator when optional fields are absent (issue #228)', () => {
    // A tutor with no per-offering rate and no classLevel used to render a
    // dangling "€/h" and "Mathematics · 6e ·" -- visibly glitched next to a
    // populated card. The type says rate: number, but searchTutors passes
    // offering.rate through unvalidated, so the runtime value can be absent.
    renderWithProviders(<TutorCard result={tutor({ rate: undefined as unknown as number, classLevel: '' })} />);
    expect(screen.queryByText(/€\/h/)).not.toBeInTheDocument();
    const subtitle = screen.getByText(/6e/);
    expect(subtitle.textContent?.trim().endsWith('·')).toBe(false);
  });

  it('renders rate and full subtitle when the fields are present', () => {
    renderWithProviders(<TutorCard result={tutor()} />);
    expect(screen.getByText(/25\s*€\/h|€\/h/)).toBeInTheDocument();
    expect(screen.getByText(/Terminale/)).toBeInTheDocument();
  });

  it('renders a humanized cancellation-notice line when the policy is set', () => {
    renderWithProviders(<TutorCard result={tutor({ cancellationNoticeHours: 48 })} />);
    expect(screen.getByText(/48h cancellation notice/i)).toBeInTheDocument();
  });

  it('renders the 1-week policy as a week window', () => {
    renderWithProviders(<TutorCard result={tutor({ cancellationNoticeHours: 168 })} />);
    expect(screen.getByText(/1 week cancellation notice/i)).toBeInTheDocument();
  });

  it('shows no cancellation-notice line when the policy is 0', () => {
    renderWithProviders(<TutorCard result={tutor({ cancellationNoticeHours: 0 })} />);
    expect(screen.queryByText(/cancellation notice/i)).not.toBeInTheDocument();
  });

  // ── Endorsements lazy-load ──
  const expand = () =>
    fireEvent.click(screen.getByRole('button', { name: /show|more|details|less/i }));

  it('lazily queries approved endorsements on expand and lists refName + text', async () => {
    h.results.set('tutorUserId', [
      { submittedByName: 'Mme Dupont', referenceText: 'Great tutor.' },
    ]);
    renderWithProviders(<TutorCard result={tutor({ endorsementCount: 1 })} />);

    // Not fetched until expanded.
    expect(h.getDocs).not.toHaveBeenCalled();

    expand();

    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    expect(h.where).toHaveBeenCalledWith('tutorUserId', '==', 't1');
    expect(h.where).toHaveBeenCalledWith('status', 'in', ['approved', 'published']);
    expect(await screen.findByText(/Mme Dupont/)).toBeInTheDocument();
    expect(screen.getByText(/Great tutor/)).toBeInTheDocument();
  });

  // ── Cross-app endorsements (issue #280) ──
  it('issues one status-constrained query per product, study first', async () => {
    renderWithProviders(<TutorCard result={tutor()} />);
    expand();
    await waitFor(() => expect(h.queries).toHaveLength(3));
    // Order is the contract: study's own field leads, siblings follow.
    expect(h.queries.map((q) => (q[1] as { field: string }).field)).toEqual([
      'tutorUserId',
      'babysitterUserId',
      'doerUserId',
    ]);
    for (const q of h.queries) {
      // NOT optional: the H2-hardened references rule grants an unrelated
      // family only the public-status disjunct, provable only from the query.
      expect(q[2]).toEqual({ field: 'status', op: 'in', val: ['approved', 'published'] });
    }
  });

  it('renders study endorsements first, then sit ones labeled with their origin', async () => {
    h.results.set('tutorUserId', [
      { submittedByName: 'Famille Etude', referenceText: 'Patient maths tutor' },
    ]);
    h.results.set('babysitterUserId', [
      { refName: 'Famille Garde', referenceText: 'Great with our kids' },
    ]);
    renderWithProviders(<TutorCard result={tutor()} />);
    expand();

    await waitFor(() => expect(screen.getByText(/Patient maths tutor/)).toBeInTheDocument());
    const texts = screen.getAllByText(/Patient maths tutor|Great with our kids/).map(
      (el) => el.textContent,
    );
    expect(texts[0]).toContain('Patient maths tutor');

    // The sit entry carries its origin; the study one — the current app's own
    // signal — carries none, so cross-app text never reads as tutoring signal.
    expect(screen.getByText('From Sync/Sit')).toBeInTheDocument();
    const studyBlock = screen.getByText(/Patient maths tutor/).parentElement!;
    expect(studyBlock.textContent).not.toContain('From Sync/');
  });

  it('loads endorsements even when the STUDY endorsement count is zero', async () => {
    // endorsementCount is the study-only tally searchTutors projects; gating
    // the fetch on it would hide every sit reference a tutor carries.
    h.results.set('babysitterUserId', [
      { refName: 'Famille Garde', referenceText: 'Great with our kids' },
    ]);
    renderWithProviders(<TutorCard result={tutor({ endorsementCount: 0 })} />);
    expand();

    expect(await screen.findByText(/Great with our kids/)).toBeInTheDocument();
    expect(screen.getByText('From Sync/Sit')).toBeInTheDocument();
  });

  it('keeps the card intact when the endorsement queries are denied', async () => {
    h.getDocs.mockRejectedValue(new Error('permission-denied'));
    renderWithProviders(<TutorCard result={tutor()} />);
    expand();

    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /request contact/i })).toBeInTheDocument();
  });
});
