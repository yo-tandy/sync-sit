import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The tutor SessionsPage reads study-sessions
// where tutorUserId==me (sorted client-side, see the component note) and
// responds via the respondToSession callable ({sessionId, action}).
const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 't1' } as { uid: string } | null },
  sessions: [] as Record<string, unknown>[],
  // Instance docs per series (study-sessions/{sid}/instances), keyed by sessionId.
  instances: {} as Record<string, Record<string, unknown>[]>,
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
  h.instances = {};
  h.where.mockClear();
  h.getDocs.mockReset();
  // Route by collection path: 'study-sessions' → the sessions query;
  // 'study-sessions/{sid}/instances' → that series' instance subcollection.
  // Handles both a query() (→ .query[0].path) and a bare collection() ref (→ .path).
  h.getDocs.mockImplementation((q: { query?: { path: string }[]; path?: string }) => {
    const path = q?.query?.[0]?.path ?? q?.path ?? '';
    if (path.endsWith('/instances')) {
      const sid = path.split('/')[1];
      const rows = h.instances[sid] ?? [];
      return Promise.resolve({ docs: rows.map((r) => ({ id: r.instanceId, data: () => r })) });
    }
    return Promise.resolve({ docs: h.sessions.map((s) => ({ id: s.sessionId, data: () => s })) });
  });
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

// ── Upcoming / history / cancellation (Task 3) ──
// "today" is pinned so date>=today filtering is deterministic. 2026-08-01T09:00Z
// is Paris 2026-08-01.
describe('tutor SessionsPage — management', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-01T09:00:00Z'));
    reset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function confirmedOneTime(overrides: Record<string, unknown> = {}) {
    return oneTime({ status: 'confirmed', ...overrides });
  }
  function confirmedRecurring(overrides: Record<string, unknown> = {}) {
    return recurring({ status: 'confirmed', ...overrides });
  }
  function instanceDoc(overrides: Record<string, unknown> = {}) {
    return {
      instanceId: '2026-08-10',
      sessionId: 'sR',
      date: '2026-08-10',
      startTime: '17:00',
      endTime: '18:00',
      status: 'scheduled',
      location: 'online',
      ...overrides,
    };
  }

  it('interleaves confirmed one_time sessions and recurring series by date', async () => {
    h.sessions = [
      confirmedOneTime({ sessionId: 's1', familyName: 'Cohen', date: '2026-08-20' }),
      confirmedRecurring({ sessionId: 'sR', familyName: 'Levy' }),
    ];
    h.instances = {
      sR: [
        instanceDoc({ instanceId: '2026-08-05', date: '2026-08-05' }),
        instanceDoc({ instanceId: '2026-08-12', date: '2026-08-12' }),
      ],
    };
    renderWithProviders(<SessionsPage />);

    const levy = await screen.findByText('Levy');
    const cohen = await screen.findByText('Cohen');
    // Series' earliest instance (Aug 5) precedes the one_time (Aug 20).
    expect(levy.compareDocumentPosition(cohen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('expands a series to its instance list with status chips (skipped, completed)', async () => {
    h.sessions = [confirmedRecurring({ sessionId: 'sR', familyName: 'Levy' })];
    h.instances = {
      sR: [
        instanceDoc({ instanceId: '2026-08-05', date: '2026-08-05', status: 'scheduled' }),
        instanceDoc({
          instanceId: '2026-08-12',
          date: '2026-08-12',
          status: 'cancelled',
          statusReason: 'conflict_skip',
        }),
        instanceDoc({ instanceId: '2026-07-22', date: '2026-07-22', status: 'completed' }),
      ],
    };
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /view dates|expand|occurrences/i }));

    expect(await screen.findByText(/skipped/i)).toBeInTheDocument();
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
    // The scheduled future date is cancelable.
    expect(screen.getByRole('button', { name: /cancel this date/i })).toBeInTheDocument();
  });

  it('cancel session → reason modal → cancelSession({sessionId, reason}) trimmed', async () => {
    h.sessions = [confirmedOneTime({ sessionId: 'sOT', date: '2026-08-20' })];
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /cancel session/i }));
    fireEvent.change(await screen.findByRole('textbox'), {
      target: { value: '  scheduling clash  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelSession', {
        sessionId: 'sOT',
        reason: 'scheduling clash',
      }),
    );
  });

  it('cancel this date → cancelSessionInstance({sessionId, instanceId, reason})', async () => {
    h.sessions = [confirmedRecurring({ sessionId: 'sR' })];
    h.instances = { sR: [instanceDoc({ instanceId: '2026-08-05', date: '2026-08-05' })] };
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /view dates|expand|occurrences/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel this date/i }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'moving away' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelSessionInstance', {
        sessionId: 'sR',
        instanceId: '2026-08-05',
        reason: 'moving away',
      }),
    );
  });

  it('cancel series → cancelSession on the parent', async () => {
    h.sessions = [confirmedRecurring({ sessionId: 'sR' })];
    h.instances = { sR: [instanceDoc({ instanceId: '2026-08-05', date: '2026-08-05' })] };
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /cancel series/i }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'family paused' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelSession', {
        sessionId: 'sR',
        reason: 'family paused',
      }),
    );
  });

  it('requires a reason of ≥3 chars before the confirm button enables', async () => {
    h.sessions = [confirmedOneTime({ sessionId: 'sOT', date: '2026-08-20' })];
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /cancel session/i }));
    const confirm = screen.getByRole('button', { name: /confirm cancellation/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'no' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'busy that week' } });
    expect(confirm).toBeEnabled();
  });

  it('applies cancelled status ONLY after the callable resolves (non-optimistic)', async () => {
    const d = deferred<{ data: { success: boolean } }>();
    h.callable.mockReturnValue(d.promise);
    h.sessions = [confirmedOneTime({ sessionId: 'sOT', date: '2026-08-20' })];
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /cancel session/i }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'conflict' } });
    const confirm = screen.getByRole('button', { name: /confirm cancellation/i });
    fireEvent.click(confirm);

    // In flight: disabled, and the cancel action still exists (not yet cancelled).
    expect(confirm).toBeDisabled();

    d.resolve({ data: { success: true } });
    // Resolves → session leaves upcoming; the trigger is gone.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel session/i })).not.toBeInTheDocument(),
    );
  });

  it('re-enables and shows an error when a cancel callable rejects', async () => {
    const d = deferred<{ data: { success: boolean } }>();
    h.callable.mockReturnValue(d.promise);
    h.sessions = [confirmedOneTime({ sessionId: 'sOT', date: '2026-08-20' })];
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /cancel session/i }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'conflict' } });
    const confirm = screen.getByRole('button', { name: /confirm cancellation/i });
    fireEvent.click(confirm);

    d.reject({ code: 'functions/internal' });

    expect(await screen.findByText(/something went wrong|couldn.?t/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirm cancellation/i })).toBeEnabled(),
    );
  });

  it('renders terminal parents in a read-only history section', async () => {
    h.sessions = [
      confirmedOneTime({ sessionId: 'd1', familyName: 'Declined Fam', status: 'declined' }),
      confirmedOneTime({ sessionId: 'c1', familyName: 'Cancelled Fam', status: 'cancelled' }),
      confirmedOneTime({ sessionId: 'x1', familyName: 'Completed Fam', status: 'completed' }),
    ];
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByText('Declined Fam')).toBeInTheDocument();
    expect(screen.getByText('Cancelled Fam')).toBeInTheDocument();
    expect(screen.getByText('Completed Fam')).toBeInTheDocument();
    // Read-only: no accept / cancel actions on history rows.
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel session/i })).not.toBeInTheDocument();
  });
});
