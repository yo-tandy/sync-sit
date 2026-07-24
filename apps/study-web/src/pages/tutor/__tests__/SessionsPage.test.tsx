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

  it('badges a pending recurring trial series and states the trial request', async () => {
    h.sessions = [recurring({ trialFirstSession: true })];
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByText('Levy')).toBeInTheDocument();
    // A Trial badge on the card, plus the request copy for the tutor.
    expect(screen.getByText(/^Trial$/)).toBeInTheDocument();
    expect(screen.getByText(/first session as a trial/i)).toBeInTheDocument();
  });

  it('does NOT badge a non-trial pending recurring series', async () => {
    h.sessions = [recurring()];
    renderWithProviders(<SessionsPage />);

    await screen.findByText('Levy');
    expect(screen.queryByText(/^Trial$/)).not.toBeInTheDocument();
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

    // Backend has now confirmed it; the post-confirm reload observes that state.
    h.sessions = [oneTime({ status: 'confirmed' })];
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

  it('badges the isTrial instance in the expanded series list', async () => {
    h.sessions = [confirmedRecurring({ sessionId: 'sR', familyName: 'Levy' })];
    h.instances = {
      sR: [
        instanceDoc({ instanceId: '2026-08-05', date: '2026-08-05', isTrial: true }),
        instanceDoc({ instanceId: '2026-08-12', date: '2026-08-12' }),
      ],
    };
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /view dates|expand|occurrences/i }));
    // Exactly the flagged occurrence is badged.
    const marks = await screen.findAllByText(/^Trial$/);
    expect(marks).toHaveLength(1);
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

  it('filters the nested instance read by tutorUserId (rule provability)', async () => {
    h.sessions = [confirmedRecurring({ sessionId: 'sR', familyName: 'Levy' })];
    h.instances = { sR: [instanceDoc({ instanceId: '2026-08-05', date: '2026-08-05' })] };
    renderWithProviders(<SessionsPage />);
    await screen.findByText('Levy');

    // The instances query MUST carry where('tutorUserId','==',me) — an unfiltered
    // list is unprovable against the per-doc rule → PERMISSION_DENIED.
    const instanceCall = h.getDocs.mock.calls.find((c) => {
      const q = c[0] as { query?: { path: string }[]; path?: string };
      return (q?.query?.[0]?.path ?? q?.path ?? '').endsWith('/instances');
    });
    expect(instanceCall).toBeTruthy();
    expect((instanceCall![0] as { query: unknown[] }).query).toContainEqual({
      where: ['tutorUserId', '==', 't1'],
    });
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

// ── Task 1: refetch after a successful confirm ──
// A confirm materialises server state (recurring instances especially), so the
// page re-runs its own load rather than only flipping the row's status locally.
describe('tutor SessionsPage — refetch after confirm', () => {
  beforeEach(() => reset());

  it('refetches sessions + instances after a recurring confirm so new dates appear', async () => {
    // Starts as a pending recurring series with no instances yet.
    h.sessions = [recurring({ sessionId: 'sR', status: 'pending' })];
    h.instances = {};
    const d = deferred<{ data: Record<string, unknown> }>();
    h.callable.mockReturnValue(d.promise);

    renderWithProviders(<SessionsPage />);
    await screen.findByText('Levy');
    const before = h.getDocs.mock.calls.length;

    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    // Backend confirmed the series and materialised its instances; the reload
    // must observe them (the whole point — the series shows its dates with no
    // manual refresh).
    h.sessions = [recurring({ sessionId: 'sR', status: 'confirmed' })];
    h.instances = {
      sR: [
        {
          instanceId: '2026-09-07',
          sessionId: 'sR',
          date: '2026-09-07',
          startTime: '17:00',
          endTime: '18:00',
          status: 'scheduled',
          location: 'online',
        },
      ],
    };
    d.resolve({
      data: { success: true, confirmed: true, scheduledDates: ['2026-09-07'], skippedDates: [] },
    });

    // getDocs re-ran (sessions + the now-confirmed series' instance subcollection).
    await waitFor(() => expect(h.getDocs.mock.calls.length).toBeGreaterThan(before));

    // Dismiss the result dialog, expand the series → the new instance date shows.
    fireEvent.click(await screen.findByRole('button', { name: /^done$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /view dates/i }));
    expect(await screen.findByText(/Sep 7, 2026/)).toBeInTheDocument();
  });

  it('refetches after a one_time confirm', async () => {
    h.sessions = [oneTime({ sessionId: 'sA', status: 'pending' })];
    renderWithProviders(<SessionsPage />);
    await screen.findByText('Cohen');
    const before = h.getDocs.mock.calls.length;

    // Backend flips it to confirmed; the reload observes the new state.
    h.sessions = [oneTime({ sessionId: 'sA', status: 'confirmed' })];
    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    await waitFor(() => expect(h.getDocs.mock.calls.length).toBeGreaterThan(before));
  });

  it('does NOT refetch when the confirm fails', async () => {
    h.sessions = [oneTime({ sessionId: 'sF', status: 'pending' })];
    h.callable.mockRejectedValue({ code: 'functions/internal' });
    renderWithProviders(<SessionsPage />);
    await screen.findByText('Cohen');
    const before = h.getDocs.mock.calls.length;

    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    // Error surfaces; a failed confirm must not trigger a reload.
    await screen.findByText(/something went wrong|couldn.?t/i);
    expect(h.getDocs.mock.calls.length).toBe(before);
  });
});

// ── Task 2: session notes (the tutor authors the POST-note) ──
// The window: the post-note is writable only once a session has STARTED, so it
// surfaces on started/completed targets — never on a not-yet-started row (where
// the family's pre-note shows read-only). Time is pinned so timing is deterministic.
describe('tutor SessionsPage — session notes (post)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Paris (CEST, UTC+2) reads 2026-08-01 11:00.
    vi.setSystemTime(new Date('2026-08-01T09:00:00Z'));
    reset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function confirmedOneTime(overrides: Record<string, unknown> = {}) {
    return oneTime({ status: 'confirmed', date: '2026-08-20', ...overrides });
  }
  function confirmedRecurring(overrides: Record<string, unknown> = {}) {
    return recurring({ status: 'confirmed', ...overrides });
  }
  function instanceDoc(overrides: Record<string, unknown> = {}) {
    return {
      instanceId: '2026-08-12',
      sessionId: 'sR',
      date: '2026-08-12',
      startTime: '17:00',
      endTime: '18:00',
      status: 'scheduled',
      location: 'online',
      ...overrides,
    };
  }

  it('shows the family pre-note read-only on an upcoming (not-started) row — no post affordance', async () => {
    h.sessions = [confirmedOneTime({ sessionId: 'sN', preSessionNote: 'Please cover fractions.' })];
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByText('Please cover fractions.')).toBeInTheDocument();
    expect(screen.getByText(/from the family/i)).toBeInTheDocument();
    // Not started yet → the tutor cannot write the post-note.
    expect(
      screen.queryByRole('button', { name: /add session notes|edit session notes/i }),
    ).not.toBeInTheDocument();
  });

  it('a started one_time (completed) offers an add-post affordance', async () => {
    h.sessions = [oneTime({ sessionId: 'sC', status: 'completed', date: '2026-07-20' })];
    renderWithProviders(<SessionsPage />);

    expect(
      await screen.findByRole('button', { name: /add session notes/i }),
    ).toBeInTheDocument();
  });

  it('saving a post-note calls setSessionNote with {sessionId, kind:post, text}', async () => {
    h.sessions = [oneTime({ sessionId: 'sC', status: 'completed', date: '2026-07-20' })];
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /add session notes/i }));
    fireEvent.change(await screen.findByRole('textbox'), {
      target: { value: 'Covered fractions; homework p.42.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('setSessionNote', {
        sessionId: 'sC',
        kind: 'post',
        text: 'Covered fractions; homework p.42.',
      }),
    );
  });

  it('editing a post-note seeds the textarea and clearing it sends empty text', async () => {
    h.sessions = [
      oneTime({ sessionId: 'sC', status: 'completed', date: '2026-07-20', postSessionNote: 'old summary' }),
    ];
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /edit session notes/i }));
    const textarea = await screen.findByRole('textbox');
    expect(textarea).toHaveValue('old summary');

    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('setSessionNote', {
        sessionId: 'sC',
        kind: 'post',
        text: '',
      }),
    );
  });

  it('adds a post-note to a started series occurrence → setSessionNote carries instanceId', async () => {
    h.sessions = [confirmedRecurring({ sessionId: 'sR' })];
    // A past occurrence (already started) — post is writable.
    h.instances = { sR: [instanceDoc({ instanceId: '2026-07-20', date: '2026-07-20', status: 'scheduled' })] };
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /view dates/i }));
    fireEvent.click(await screen.findByRole('button', { name: /add session notes/i }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'went well' } });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('setSessionNote', {
        sessionId: 'sR',
        instanceId: '2026-07-20',
        kind: 'post',
        text: 'went well',
      }),
    );
  });

  it('does NOT offer the post affordance on a future series occurrence (pre shows read-only)', async () => {
    h.sessions = [confirmedRecurring({ sessionId: 'sR' })];
    h.instances = {
      sR: [
        instanceDoc({
          instanceId: '2026-08-12',
          date: '2026-08-12',
          status: 'scheduled',
          preSessionNote: 'Ratios please',
        }),
      ],
    };
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /view dates/i }));
    expect(await screen.findByText('Ratios please')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /add session notes|edit session notes/i }),
    ).not.toBeInTheDocument();
  });

  it('post-save is non-optimistic — the callable resolves before the dialog closes', async () => {
    const d = deferred<{ data: { success: boolean } }>();
    h.callable.mockReturnValue(d.promise);
    h.sessions = [oneTime({ sessionId: 'sC', status: 'completed', date: '2026-07-20' })];
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /add session notes/i }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'summary' } });
    const save = screen.getByRole('button', { name: /save note/i });
    fireEvent.click(save);
    expect(save).toBeDisabled();

    d.resolve({ data: { success: true } });
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  });
});

// ── Task 2: the tutor's OWN proposals + propose entry points ──
// A pending proposedBy:'provider' doc is the FAMILY's to accept — the tutor sees
// "Awaiting the family" and may only withdraw it (cancel), NEVER accept/decline.
// Completed cards offer "Propose a session" to re-engage the family.
describe('tutor SessionsPage — proposals & entry', () => {
  beforeEach(() => reset());

  it('renders a provider proposal as awaiting-family, cancel-only (no accept/decline)', async () => {
    h.sessions = [oneTime({ sessionId: 'sPr', proposedBy: 'provider', students: [], status: 'pending' })];
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByText(/awaiting the family/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^decline$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel session/i })).toBeInTheDocument();
    // Empty roster → 'chosen when the family accepts' hint.
    expect(screen.getByText(/chosen when the family accepts/i)).toBeInTheDocument();
  });

  it('a family-initiated pending still shows Accept/Decline (not awaiting-family)', async () => {
    h.sessions = [oneTime({ status: 'pending' })]; // no proposedBy
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument();
    expect(screen.queryByText(/awaiting the family/i)).not.toBeInTheDocument();
  });

  it('offers "Propose a session" on a completed card only (not declined/cancelled)', async () => {
    h.sessions = [
      oneTime({ sessionId: 'c1', status: 'completed' }),
      oneTime({ sessionId: 'd1', status: 'declined' }),
    ];
    renderWithProviders(<SessionsPage />);

    await screen.findByText(/History/i);
    expect(screen.getAllByRole('button', { name: /propose a session/i })).toHaveLength(1);
  });
});
