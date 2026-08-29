import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The tutor EndorsementsPage reads the shared
// `references` collection where tutorUserId==me, ordered createdAt desc (the
// (tutorUserId, createdAt) composite exists — unlike studyContactRequests, so
// the query orders server-side rather than client-side), and moderates via the
// respondToTutorEndorsement callable.
const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 't1' } as { uid: string } | null },
  refs: [] as Record<string, unknown>[],
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  orderBy: vi.fn((field: string, dir: string) => ({ orderBy: [field, dir] })),
  getDocs: vi.fn(),
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  orderBy: (...args: [string, string]) => h.orderBy(...args),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { EndorsementsPage } from '../EndorsementsPage';

/** A promise whose settlement the test controls, for asserting in-flight state. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function ts(seconds: number) {
  return { seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) };
}

function refDoc(overrides: Record<string, unknown> = {}) {
  return {
    referenceId: 'e1',
    tutorUserId: 't1',
    appSource: 'study',
    type: 'family_submitted',
    submittedByFamilyId: 'fam1',
    submittedByUserId: 'p1',
    submittedByName: 'Dana Weiss',
    refName: 'Dana W.',
    referenceText: 'Alex helped my daughter go from struggling to top of her class.',
    subject: 'math',
    status: 'private',
    createdAt: ts(1_700_000_000),
    updatedAt: ts(1_700_000_000),
    ...overrides,
  };
}

function reset() {
  h.auth.firebaseUser = { uid: 't1' };
  h.refs = [];
  h.where.mockClear();
  h.orderBy.mockClear();
  h.getDocs.mockReset();
  h.getDocs.mockImplementation(() =>
    Promise.resolve({ docs: h.refs.map((r) => ({ id: r.referenceId, data: () => r })) }),
  );
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { ok: true } });
}

describe('tutor EndorsementsPage', () => {
  beforeEach(() => reset());

  // ── Issue #354: the forged pre-#352 doc must never render ──
  //
  // The query cannot exclude it: this page shows `private` rows, so it filters
  // on nothing but tutorUserId, and the victim's recipient-read disjunct grants
  // the read. Before PR #352 the create rule left every field but four
  // unconstrained, so a caller could write a reference about THEMSELVES
  // (babysitterUserId = self, which the rule pins) while ALSO setting a foreign
  // tutorUserId, plus arbitrary body and attribution.
  //
  // Such a row is worse than noise: it is unremovable by the tutor.
  // respondToTutorEndorsement refuses it at `type !== 'family_submitted'`, and
  // the update rule's owner branch keys on the ATTACKER's babysitterUserId.
  // Rendering it puts attacker-controlled text on the tutor's page with no way
  // to clear it.
  const forged = () =>
    refDoc({
      referenceId: 'forged1',
      // A sit-shaped manual reference the attacker wrote about themselves...
      babysitterUserId: 'attacker',
      submittedByUserId: 'attacker',
      appSource: undefined,
      type: 'manual',
      // ...carrying the victim's key, which is what granted the read.
      tutorUserId: 't1',
      referenceText: 'CALL 555-SCAM for cheaper lessons',
      submittedByName: 'Sync/Study Support',
    });

  it('does not render a forged doc that the response callable would refuse', async () => {
    h.refs = [forged()];
    renderWithProviders(<EndorsementsPage />);
    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    expect(screen.queryByText(/CALL 555-SCAM/)).toBeNull();
    expect(screen.queryByText(/Sync\/Study Support/)).toBeNull();
  });

  it('still renders the legitimate endorsement alongside a forged one', async () => {
    // The filter must not be a blunt instrument: the real row keeps working.
    h.refs = [forged(), refDoc({ referenceId: 'real1' })];
    renderWithProviders(<EndorsementsPage />);
    expect(
      await screen.findByText(/Alex helped my daughter/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/CALL 555-SCAM/)).toBeNull();
  });

  it('excludes a doc carrying another app\'s appSource', async () => {
    // Same collection serves sit and sync-do. Only study rows belong here, and
    // only this app's callable can act on them.
    h.refs = [refDoc({ referenceId: 'doRow', appSource: 'do' })];
    renderWithProviders(<EndorsementsPage />);
    await waitFor(() => expect(h.getDocs).toHaveBeenCalled());
    expect(screen.queryByText(/Alex helped my daughter/)).toBeNull();
  });

  it('queries references for the signed-in tutor, ordered createdAt desc', async () => {
    h.refs = [refDoc()];
    renderWithProviders(<EndorsementsPage />);
    await screen.findByText(/Alex helped my daughter/);

    expect(h.where).toHaveBeenCalledWith('tutorUserId', '==', 't1');
    expect(h.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    const collectionArg = h.getDocs.mock.calls[0][0].query[0];
    expect(collectionArg.path).toBe('references');
  });

  it('renders a pending endorsement with text, submitter, subject and actions', async () => {
    h.refs = [refDoc()];
    renderWithProviders(<EndorsementsPage />);

    expect(await screen.findByText(/Alex helped my daughter/)).toBeInTheDocument();
    expect(screen.getByText(/Dana Weiss/)).toBeInTheDocument();
    // Subject taxonomy label (tutor.subjects.names.math => "Mathematics").
    expect(screen.getByText(/Mathematics/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('groups by status: private=pending (actionable), approved/published=read-only, removed hidden', async () => {
    h.refs = [
      refDoc({ referenceId: 'p', referenceText: 'Pending one', status: 'private' }),
      refDoc({ referenceId: 'a', referenceText: 'Approved one', status: 'approved' }),
      refDoc({ referenceId: 'pub', referenceText: 'Published one', status: 'published' }),
      refDoc({ referenceId: 'rm', referenceText: 'Removed one', status: 'removed' }),
    ];
    renderWithProviders(<EndorsementsPage />);
    await screen.findByText(/Pending one/);

    // approved + published are shown, read-only.
    expect(screen.getByText(/Approved one/)).toBeInTheDocument();
    expect(screen.getByText(/Published one/)).toBeInTheDocument();
    // removed is hidden entirely.
    expect(screen.queryByText(/Removed one/)).not.toBeInTheDocument();
    // Exactly one actionable pair (the pending doc).
    expect(screen.getAllByRole('button', { name: /accept/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /dismiss/i })).toHaveLength(1);
  });

  it('accept → respondToTutorEndorsement({referenceId, action:accept})', async () => {
    h.refs = [refDoc({ referenceId: 'eA' })];
    renderWithProviders(<EndorsementsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToTutorEndorsement', {
        referenceId: 'eA',
        action: 'accept',
      }),
    );
  });

  it('dismiss requires confirmation, then sends action:dismiss', async () => {
    h.refs = [refDoc({ referenceId: 'eD' })];
    renderWithProviders(<EndorsementsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /dismiss/i }));

    // Confirm dialog — nothing sent until confirmed (dismiss is permanent).
    expect(h.callable).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /yes, dismiss/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToTutorEndorsement', {
        referenceId: 'eD',
        action: 'dismiss',
      }),
    );
  });

  it('applies the accepted state ONLY after the callable resolves (non-optimistic)', async () => {
    const d = deferred<{ data: { ok: boolean } }>();
    h.callable.mockReturnValue(d.promise);
    h.refs = [refDoc()];
    renderWithProviders(<EndorsementsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    // In flight: still pending (Accept present) but its actions are disabled.
    expect(screen.getByRole('button', { name: /accept/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeDisabled();

    // Resolve → doc becomes approved, moves to the read-only Published section.
    d.resolve({ data: { ok: true } });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Alex helped my daughter/)).toBeInTheDocument();
  });

  it('keeps the row pending + re-enabled and shows an error when the callable rejects', async () => {
    const d = deferred<{ data: { ok: boolean } }>();
    h.callable.mockReturnValue(d.promise);
    h.refs = [refDoc()];
    renderWithProviders(<EndorsementsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));
    expect(screen.getByRole('button', { name: /accept/i })).toBeDisabled();

    d.reject({ code: 'functions/internal' });

    expect(await screen.findByText(/couldn.?t update|something went wrong/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accept/i })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('formats a plain Date createdAt (emulator rows) instead of blanking it', async () => {
    h.refs = [refDoc({ createdAt: new Date('2026-07-10T12:00:00') })];
    renderWithProviders(<EndorsementsPage />);
    await screen.findByText(/Alex helped my daughter/);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no visible endorsements', async () => {
    h.refs = [refDoc({ status: 'removed' })]; // only removed => nothing to show
    renderWithProviders(<EndorsementsPage />);
    expect(await screen.findByText(/no endorsements yet/i)).toBeInTheDocument();
  });
});
