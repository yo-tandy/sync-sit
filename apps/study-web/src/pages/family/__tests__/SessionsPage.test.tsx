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
  h.where.mockClear();
  h.getDocs.mockReset();
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
