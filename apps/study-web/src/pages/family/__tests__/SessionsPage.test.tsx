import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The family SessionsPage reads study-sessions
// where familyId==mine (sorted client-side) and cancels via cancelSession /
// cancelSessionInstance. Instances are read via the nested per-series path.
const h = vi.hoisted(() => ({
  auth: { userDoc: null as unknown },
  sessions: [] as Record<string, unknown>[],
  instances: {} as Record<string, Record<string, unknown>[]>,
  // references docs (this family's submitted study endorsements) — feeds the
  // "already endorsed" gate on completed sessions.
  refs: [] as Record<string, unknown>[],
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

import { SessionsPage } from '../SessionsPage';

function ts(seconds: number) {
  return { seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) };
}

function parent() {
  return {
    uid: 'p1',
    firstName: 'Dana',
    lastName: 'Cohen',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
  };
}

function oneTime(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 's1',
    tutorUserId: 't1',
    familyId: 'fam1',
    familyName: 'Cohen',
    parentName: 'Dana Cohen',
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
    status: 'pending',
    createdAt: ts(1_700_000_000),
    ...overrides,
  };
}

function recurring(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sR',
    tutorUserId: 't1',
    familyId: 'fam1',
    familyName: 'Cohen',
    parentName: 'Dana Cohen',
    tutorName: 'Sam Tutor',
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

function reset() {
  h.auth.userDoc = parent();
  h.sessions = [];
  h.instances = {};
  h.refs = [];
  h.where.mockClear();
  h.getDocs.mockReset();
  h.getDocs.mockImplementation((q: { query?: { path: string }[]; path?: string }) => {
    const path = q?.query?.[0]?.path ?? q?.path ?? '';
    if (path.endsWith('/instances')) {
      const sid = path.split('/')[1];
      const rows = h.instances[sid] ?? [];
      return Promise.resolve({ docs: rows.map((r) => ({ id: r.instanceId, data: () => r })) });
    }
    if (path === 'references') {
      return Promise.resolve({ docs: h.refs.map((r) => ({ id: r.referenceId, data: () => r })) });
    }
    return Promise.resolve({ docs: h.sessions.map((s) => ({ id: s.sessionId, data: () => s })) });
  });
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { success: true } });
}

describe('family SessionsPage', () => {
  beforeEach(() => reset());

  it('queries study-sessions for the signed-in family', async () => {
    h.sessions = [oneTime()];
    renderWithProviders(<SessionsPage />);
    await screen.findByText(/Alex Roy/);

    expect(h.where).toHaveBeenCalledWith('familyId', '==', 'fam1');
    const collectionArg = h.getDocs.mock.calls[0][0].query[0];
    expect(collectionArg.path).toBe('study-sessions');
  });

  it('renders a pending session showing the tutor and a cancel action', async () => {
    h.sessions = [oneTime()];
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByText(/Alex Roy/)).toBeInTheDocument();
    expect(screen.getByText(/6e/)).toBeInTheDocument();
    expect(screen.getByText(/Emma \(10\)/)).toBeInTheDocument();
    // Family cancels a pending request (no accept/decline — that's the tutor's).
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel request|cancel session/i })).toBeInTheDocument();
  });

  it('shows an empty state when the family has no sessions', async () => {
    h.sessions = [];
    renderWithProviders(<SessionsPage />);
    expect(await screen.findByText(/no sessions/i)).toBeInTheDocument();
  });

  it('cancel a pending request → cancelSession({sessionId, reason}) trimmed', async () => {
    h.sessions = [oneTime({ sessionId: 'sP' })];
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /cancel request|cancel session/i }));
    fireEvent.change(await screen.findByRole('textbox'), {
      target: { value: '  changed our mind  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelSession', {
        sessionId: 'sP',
        reason: 'changed our mind',
      }),
    );
  });
});

// ── Upcoming / history / cancellation (pinned "today") ──
describe('family SessionsPage — management', () => {
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

  it('interleaves confirmed one_time sessions and recurring series by date', async () => {
    h.sessions = [
      confirmedOneTime({ sessionId: 's1', tutorName: 'One Time Tutor', date: '2026-08-20' }),
      confirmedRecurring({ sessionId: 'sR', tutorName: 'Series Tutor' }),
    ];
    h.instances = {
      sR: [
        instanceDoc({ instanceId: '2026-08-05', date: '2026-08-05' }),
        instanceDoc({ instanceId: '2026-08-12', date: '2026-08-12' }),
      ],
    };
    renderWithProviders(<SessionsPage />);

    const series = await screen.findByText('Series Tutor');
    const oneT = await screen.findByText('One Time Tutor');
    expect(series.compareDocumentPosition(oneT) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('expands a series to its instances and cancels one date → cancelSessionInstance', async () => {
    h.sessions = [confirmedRecurring({ sessionId: 'sR' })];
    h.instances = {
      sR: [
        instanceDoc({ instanceId: '2026-08-05', date: '2026-08-05', status: 'scheduled' }),
        instanceDoc({
          instanceId: '2026-08-12',
          date: '2026-08-12',
          status: 'cancelled',
          statusReason: 'conflict_skip',
        }),
      ],
    };
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /view dates|occurrences/i }));
    expect(await screen.findByText(/skipped/i)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /cancel this date/i }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'travel week' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelSessionInstance', {
        sessionId: 'sR',
        instanceId: '2026-08-05',
        reason: 'travel week',
      }),
    );
  });

  it('cancel series → cancelSession on the parent series', async () => {
    h.sessions = [confirmedRecurring({ sessionId: 'sR' })];
    h.instances = { sR: [instanceDoc({ instanceId: '2026-08-05', date: '2026-08-05' })] };
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /cancel series/i }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'stopping lessons' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelSession', {
        sessionId: 'sR',
        reason: 'stopping lessons',
      }),
    );
  });

  it('applies cancelled status only after the callable resolves (non-optimistic)', async () => {
    let resolve!: (v: unknown) => void;
    h.callable.mockReturnValue(new Promise((r) => (resolve = r)));
    h.sessions = [confirmedOneTime({ sessionId: 'sOT', date: '2026-08-20' })];
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /cancel session/i }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'conflict' } });
    const confirm = screen.getByRole('button', { name: /confirm cancellation/i });
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();

    resolve({ data: { success: true } });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /cancel session/i })).not.toBeInTheDocument(),
    );
  });

  it('disables per-date cancel while a whole-series cancel is in flight', async () => {
    let resolve!: (v: unknown) => void;
    h.callable.mockReturnValue(new Promise((r) => (resolve = r)));
    h.sessions = [confirmedRecurring({ sessionId: 'sR' })];
    h.instances = { sR: [instanceDoc({ instanceId: '2026-08-05', date: '2026-08-05' })] };
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /view dates|occurrences/i }));
    expect(await screen.findByRole('button', { name: /cancel this date/i })).toBeEnabled();

    // Start a whole-series cancel — it voids every date, so per-date actions lock.
    fireEvent.click(screen.getByRole('button', { name: /cancel series/i }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'stopping lessons' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm cancellation/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel this date/i })).toBeDisabled(),
    );
    resolve({ data: { success: true } });
  });

  it('filters the nested instance read by familyId (rule provability)', async () => {
    h.sessions = [confirmedRecurring({ sessionId: 'sR' })];
    h.instances = { sR: [instanceDoc({ instanceId: '2026-08-05', date: '2026-08-05' })] };
    renderWithProviders(<SessionsPage />);
    await screen.findByText('Sam Tutor');

    // The instances query MUST carry where('familyId','==',mine) — an unfiltered
    // list is unprovable against the per-doc rule → PERMISSION_DENIED.
    const instanceCall = h.getDocs.mock.calls.find((c) => {
      const q = c[0] as { query?: { path: string }[]; path?: string };
      return (q?.query?.[0]?.path ?? q?.path ?? '').endsWith('/instances');
    });
    expect(instanceCall).toBeTruthy();
    expect((instanceCall![0] as { query: unknown[] }).query).toContainEqual({
      where: ['familyId', '==', 'fam1'],
    });
  });

  it('shows a load error (not the empty state) when the instances read is denied', async () => {
    h.sessions = [confirmedRecurring({ sessionId: 'sR' })];
    h.getDocs.mockImplementation((q: { query?: { path: string }[]; path?: string }) => {
      const path = q?.query?.[0]?.path ?? q?.path ?? '';
      if (path.endsWith('/instances')) return Promise.reject({ code: 'permission-denied' });
      return Promise.resolve({ docs: h.sessions.map((s) => ({ id: s.sessionId, data: () => s })) });
    });
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByText(/could not load your sessions/i)).toBeInTheDocument();
    // The denial must NOT masquerade as "no sessions".
    expect(screen.queryByText(/no sessions yet/i)).not.toBeInTheDocument();
  });

  it('renders terminal sessions in a read-only history section', async () => {
    h.sessions = [
      confirmedOneTime({ sessionId: 'd1', tutorName: 'Declined Tutor', status: 'declined' }),
      confirmedOneTime({ sessionId: 'c1', tutorName: 'Cancelled Tutor', status: 'cancelled' }),
      confirmedOneTime({ sessionId: 'x1', tutorName: 'Completed Tutor', status: 'completed' }),
    ];
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByText('Declined Tutor')).toBeInTheDocument();
    expect(screen.getByText('Cancelled Tutor')).toBeInTheDocument();
    expect(screen.getByText('Completed Tutor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel session/i })).not.toBeInTheDocument();
  });
});

// ── Task 2: endorse-after-completion prompt ──
// Completed work with a tutor the family hasn't endorsed yet surfaces an
// 'Endorse {tutor}' button opening the shared EndorseTutorDialog. "Already
// endorsed" is computed from this family's own references (submittedByFamilyId +
// appSource=='study').
describe('family SessionsPage — endorse after completion', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-01T09:00:00Z'));
    reset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function refDoc(overrides: Record<string, unknown> = {}) {
    return {
      referenceId: 'e1',
      tutorUserId: 't1',
      appSource: 'study',
      submittedByFamilyId: 'fam1',
      refName: 'Dana Cohen',
      referenceText: 'Great tutor.',
      subject: 'math',
      status: 'private',
      ...overrides,
    };
  }

  it('queries references for this family (submittedByFamilyId + appSource study)', async () => {
    h.sessions = [oneTime({ status: 'completed', tutorName: 'Alex Roy' })];
    renderWithProviders(<SessionsPage />);
    await screen.findByText('Alex Roy');

    expect(h.where).toHaveBeenCalledWith('submittedByFamilyId', '==', 'fam1');
    expect(h.where).toHaveBeenCalledWith('appSource', '==', 'study');
    const refCall = h.getDocs.mock.calls.find(
      (c) => (c[0] as { query?: { path: string }[] }).query?.[0]?.path === 'references',
    );
    expect(refCall).toBeTruthy();
  });

  it('shows an Endorse button for a completed session with an un-endorsed tutor', async () => {
    h.sessions = [oneTime({ sessionId: 'sC', status: 'completed', tutorName: 'Alex Roy' })];
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByRole('button', { name: /endorse alex roy/i })).toBeInTheDocument();
  });

  it('shows NO Endorse button when the tutor is already endorsed', async () => {
    h.sessions = [
      oneTime({ sessionId: 'sC', status: 'completed', tutorName: 'Alex Roy', tutorUserId: 't1' }),
    ];
    h.refs = [refDoc({ tutorUserId: 't1' })];
    renderWithProviders(<SessionsPage />);

    // Wait for the completed row, then confirm no endorse affordance.
    await screen.findByText('Alex Roy');
    expect(screen.queryByRole('button', { name: /endorse/i })).not.toBeInTheDocument();
  });

  it('shows NO Endorse button on a non-completed (upcoming) session', async () => {
    h.sessions = [
      oneTime({ sessionId: 'sU', status: 'confirmed', tutorName: 'Alex Roy', date: '2026-08-20' }),
    ];
    renderWithProviders(<SessionsPage />);

    await screen.findByText('Alex Roy');
    expect(screen.queryByRole('button', { name: /endorse/i })).not.toBeInTheDocument();
  });

  it('shows an Endorse button for a series with ≥1 completed instance', async () => {
    h.sessions = [confirmedRecurring({ sessionId: 'sR', tutorName: 'Sam Tutor', tutorUserId: 't9' })];
    h.instances = {
      sR: [
        instanceDoc({ instanceId: '2026-07-22', date: '2026-07-22', status: 'completed' }),
        instanceDoc({ instanceId: '2026-08-12', date: '2026-08-12', status: 'scheduled' }),
      ],
    };
    renderWithProviders(<SessionsPage />);

    expect(await screen.findByRole('button', { name: /endorse sam tutor/i })).toBeInTheDocument();
  });

  it('endorse dialog payload carries the session tutorUserId + subject; the set updates on success', async () => {
    h.sessions = [
      oneTime({
        sessionId: 'sC',
        status: 'completed',
        tutorName: 'Alex Roy',
        tutorUserId: 't1',
        subject: 'math',
      }),
    ];
    renderWithProviders(<SessionsPage />);

    fireEvent.click(await screen.findByRole('button', { name: /endorse alex roy/i }));

    fireEvent.change(await screen.findByLabelText(/your endorsement/i), {
      target: { value: 'Alex was patient and my daughter improved a lot.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith(
        'submitTutorEndorsement',
        expect.objectContaining({ tutorUserId: 't1', subject: 'math' }),
      ),
    );

    // The set updates: the endorse affordance is gone for that tutor.
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /endorse alex roy/i })).not.toBeInTheDocument(),
    );
  });

  function confirmedRecurring(overrides: Record<string, unknown> = {}) {
    return recurring({ status: 'confirmed', ...overrides });
  }
});
