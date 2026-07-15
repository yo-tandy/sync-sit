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
  endorsementDocs: [] as { data: () => Record<string, unknown> }[],
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
    requestStatus: 'none',
    ...overrides,
  };
}

function reset() {
  h.where.mockClear();
  h.limit.mockClear();
  h.endorsementDocs = [];
  h.getDocs.mockReset();
  h.getDocs.mockImplementation(() => Promise.resolve({ docs: h.endorsementDocs }));
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { requestId: 'r1' } });
}

describe('TutorCard', () => {
  beforeEach(() => reset());

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

  // ── Endorsements lazy-load ──
  it('lazily queries approved endorsements on expand and lists refName + text', async () => {
    h.endorsementDocs = [
      { data: () => ({ submittedByName: 'Mme Dupont', referenceText: 'Great tutor.' }) },
    ];
    renderWithProviders(<TutorCard result={tutor({ endorsementCount: 1 })} />);

    // Not fetched until expanded.
    expect(h.getDocs).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /endorsement|show|more|details/i }));

    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    expect(h.where).toHaveBeenCalledWith('tutorUserId', '==', 't1');
    expect(h.where).toHaveBeenCalledWith('status', 'in', ['approved', 'published']);
    expect(await screen.findByText(/Mme Dupont/)).toBeInTheDocument();
    expect(screen.getByText(/Great tutor/)).toBeInTheDocument();
  });
});
