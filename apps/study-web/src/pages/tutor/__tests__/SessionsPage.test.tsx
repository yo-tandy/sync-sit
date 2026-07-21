import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The tutor SessionsPage reads study-sessions
// where tutorUserId==me (sorted client-side, see the component note) and
// responds via the respondToSession callable ({sessionId, action}).
const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 't1' } as { uid: string } | null },
  sessions: [] as Record<string, unknown>[],
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  getDocs: vi.fn(),
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

// The recurring conflict preview does its OWN firestore reads (Task 2); stub it
// here so this page test stays focused on the inbox and isn't coupled to the
// child's data loading. It keeps the "Checking availability…" text the recurring
// card asserts on.
vi.mock('@/components/tutor/RecurringConflictPreview', () => ({
  RecurringConflictPreview: () => <div>Checking availability…</div>,
}));

import { SessionsPage } from '../SessionsPage';

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

function oneTime(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 's1',
    tutorUserId: 't1',
    familyId: 'fam1',
    familyName: 'Cohen',
    parentName: 'Dana Weiss',
    tutorName: 'Alex Roy',
    subject: 'math',
    level: '6e',
    rate: 25,
    students: [{ firstName: 'Emma', age: 10 }],
    type: 'one_time',
    date: '2026-08-15',
    startTime: '17:00',
    endTime: '18:00',
    location: 'family_home',
    message: 'Please help with algebra.',
    status: 'pending',
    createdAt: ts(1_700_000_000),
    ...overrides,
  };
}

function recurring(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sR',
    tutorUserId: 't1',
    familyId: 'fam2',
    familyName: 'Levy',
    parentName: 'Sara Levy',
    tutorName: 'Alex Roy',
    subject: 'physics',
    level: '2nde',
    rate: 30,
    students: [{ firstName: 'Noah', age: 15 }],
    type: 'recurring',
    startTime: '17:00',
    recurringSlots: [{ day: 'mon', startTime: '17:00', endTime: '18:00' }],
    schoolWeeksOnly: true,
    endDate: '2026-12-20',
    location: 'online',
    status: 'pending',
    createdAt: ts(1_700_000_500),
    ...overrides,
  };
}

function reset() {
  h.auth.firebaseUser = { uid: 't1' };
  h.sessions = [];
  h.where.mockClear();
  h.getDocs.mockReset();
  h.getDocs.mockImplementation(() =>
    Promise.resolve({ docs: h.sessions.map((s) => ({ id: s.sessionId, data: () => s })) }),
  );
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { success: true } });
}

describe('tutor SessionsPage', () => {
  beforeEach(() => reset());

  it('queries study-sessions for the signed-in tutor', async () => {
    h.sessions = [oneTime()];
    renderWithProviders(<SessionsPage />);
    await screen.findByText(/Cohen/);

    expect(h.where).toHaveBeenCalledWith('tutorUserId', '==', 't1');
    const collectionArg = h.getDocs.mock.calls[0][0].query[0];
    expect(collectionArg.path).toBe('study-sessions');
  });

  it('renders a pending one_time session with all its details', async () => {
    h.sessions = [oneTime()];
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByText(/Cohen/)).toBeInTheDocument();
    expect(screen.getByText(/Dana Weiss/)).toBeInTheDocument();
    expect(screen.getByText(/6e/)).toBeInTheDocument();
    expect(screen.getByText(/Emma \(10\)/)).toBeInTheDocument();
    expect(screen.getByText(/25 €\/h/)).toBeInTheDocument();
    expect(screen.getByText(/family's home/i)).toBeInTheDocument();
    expect(screen.getByText(/Please help with algebra/)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText(/17:00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument();
  });

  it('renders a pending recurring session with slot line, badge, end date and conflict preview', async () => {
    h.sessions = [recurring()];
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByText('Levy')).toBeInTheDocument();
    // Weekly slot line 'Every Monday 17:00–18:00'.
    expect(screen.getByText(/Every Monday/)).toBeInTheDocument();
    // schoolWeeksOnly badge + end date.
    expect(screen.getByText(/school weeks only/i)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    // Task 2's conflict-preview placeholder slot.
    expect(screen.getByText(/checking availability/i)).toBeInTheDocument();
  });

  it('accept → respondToSession({sessionId, action:confirm})', async () => {
    h.sessions = [oneTime({ sessionId: 'sA' })];
    renderWithProviders(<SessionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToSession', {
        sessionId: 'sA',
        action: 'confirm',
      }),
    );
  });

  it('decline requires confirmation, then sends action:decline', async () => {
    h.sessions = [oneTime({ sessionId: 'sD' })];
    renderWithProviders(<SessionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^decline$/i }));

    // Confirm dialog — nothing sent until confirmed.
    expect(h.callable).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /yes, decline/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToSession', {
        sessionId: 'sD',
        action: 'decline',
      }),
    );
  });

  it('applies the confirmed status ONLY after the callable resolves (non-optimistic)', async () => {
    const d = deferred<{ data: { success: boolean } }>();
    h.callable.mockReturnValue(d.promise);
    h.sessions = [oneTime()];
    renderWithProviders(<SessionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    // In flight: row is STILL pending (Accept present) but its actions are disabled.
    expect(screen.getByRole('button', { name: /accept/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeDisabled();

    // Resolve → row leaves the pending list, actions disappear.
    d.resolve({ data: { success: true } });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument(),
    );
  });

  it('keeps the row pending + re-enabled and shows an error when the callable rejects', async () => {
    const d = deferred<{ data: { success: boolean } }>();
    h.callable.mockReturnValue(d.promise);
    h.sessions = [oneTime()];
    renderWithProviders(<SessionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));
    expect(screen.getByRole('button', { name: /accept/i })).toBeDisabled();

    d.reject({ code: 'functions/internal' });

    expect(await screen.findByText(/something went wrong|couldn.?t/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /accept/i })).toBeEnabled());
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument();
  });

  it('maps a failed-precondition error to a single generic "cannot confirm" message', async () => {
    h.callable.mockRejectedValue({
      code: 'functions/failed-precondition',
      message: 'This time is no longer available',
    });
    h.sessions = [oneTime()];
    renderWithProviders(<SessionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    // Maps by CODE to one generic message — never quotes the raw reason.
    expect(await screen.findByText(/can no longer be confirmed/i)).toBeInTheDocument();
    expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
  });

  it('shows a scheduled/skipped result dialog after a recurring confirm', async () => {
    h.callable.mockResolvedValue({
      data: {
        success: true,
        confirmed: true,
        scheduledDates: [
          '2026-09-07',
          '2026-09-14',
          '2026-09-21',
          '2026-09-28',
          '2026-10-05',
          '2026-10-19',
        ],
        skippedDates: ['2026-10-12', '2026-10-26'],
      },
    });
    h.sessions = [recurring()];
    renderWithProviders(<SessionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    // 6 scheduled of 8 total, with the 2 skipped dates surfaced.
    expect(await screen.findByText(/6 of 8/)).toBeInTheDocument();
    expect(screen.getByText(/Oct 12/)).toBeInTheDocument();
    expect(screen.getByText(/Oct 26/)).toBeInTheDocument();
  });

  it('shows an empty state when the tutor has no sessions', async () => {
    h.sessions = [];
    renderWithProviders(<SessionsPage />);
    expect(await screen.findByText(/no session requests|no sessions/i)).toBeInTheDocument();
  });
});
