import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetAdminConfigClientCacheForTests } from '@/lib/adminConfigClient';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { expandRecurringDates } from '@ejm/study-core';

// The preview loads the tutor's OWN data (own-uid, rules permit): schedules/{uid}
// weekly grid, the per-date override docs, and their confirmed one_time sessions,
// then classifies each candidate date available / conflict / holiday.
const h = vi.hoisted(() => ({
  adminConfig: {} as Record<string, number>,
  uid: 't1' as string | null,
  // schedules/{uid} weekly grid.
  weekly: {} as Record<string, boolean[]>,
  // override doc per "YYYY-MM-DD" (schedules/{uid}/overrides/{date}); absent = none.
  overrides: {} as Record<string, { type: string; slots?: boolean[] }>,
  // study-sessions docs (the tutor's own; confirmed one_time ones subtract).
  sessions: [] as Record<string, unknown>[],
  // useHolidays hook state.
  periods: [] as { startDate: string; endDate: string }[],
  holidaysLoading: false,
  where: vi.fn((field: string, op: string, val: unknown) => ({ where: [field, op, val] })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: [string, string, unknown]) => h.where(...args),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ firebaseUser: h.uid ? { uid: h.uid } : null }),
}));

vi.mock('@/hooks/useHolidays', () => ({
  useHolidays: () => ({ periods: h.periods, loading: h.holidaysLoading, schoolYear: '2026-2027' }),
}));

import { RecurringConflictPreview } from '../RecurringConflictPreview';

// A fixed "now" so the candidate window is deterministic. 2026-08-01T09:00Z is
// Paris 11:00 (CEST); now+24h lands the horizon anchor on 2026-08-02, so the
// first Monday occurrence is 2026-08-03.
const NOW = new Date('2026-08-01T09:00:00Z');
const FROM = '2026-08-02';
const SLOT = { day: 'mon' as const, startTime: '17:00', endTime: '18:00' };

/** All-available weekly grid for a day (96 open 15-min slots). */
function openDay() {
  return new Array(96).fill(true);
}

function recurringSession(overrides: Record<string, unknown> = {}) {
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
    type: 'recurring' as const,
    startTime: '17:00',
    recurringSlots: [SLOT],
    schoolWeeksOnly: true,
    endDate: '2026-12-31',
    location: 'online' as const,
    status: 'pending' as const,
    ...overrides,
  };
}

function reset() {
  h.uid = 't1';
  h.weekly = { mon: openDay() };
  h.overrides = {};
  h.sessions = [];
  h.periods = [];
  h.holidaysLoading = false;
  h.where.mockClear();
  h.getDoc.mockReset();
  h.adminConfig = {};
  __resetAdminConfigClientCacheForTests();
  h.getDoc.mockImplementation((ref: { path: string }) => {
    const path = ref.path;
    if (path === 'schedules/t1') {
      return Promise.resolve({ exists: () => true, data: () => ({ weekly: h.weekly }) });
    }
    if (path === 'adminConfig/values') {
      // The preview's config reads (issue #250) -- default empty, tests
      // override h.adminConfig to model a configured value.
      return Promise.resolve({ exists: () => true, data: () => h.adminConfig });
    }
    // schedules/t1/overrides/{date}
    const date = path.split('/')[3];
    const o = h.overrides[date];
    return Promise.resolve({ exists: () => o != null, data: () => o });
  });
  h.getDocs.mockReset();
  h.getDocs.mockImplementation(() =>
    Promise.resolve({ docs: h.sessions.map((s) => ({ id: s.sessionId, data: () => s })) }),
  );
}

describe('RecurringConflictPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    reset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a loading state while holidays are still loading', () => {
    h.holidaysLoading = true;
    renderWithProviders(<RecurringConflictPreview session={recurringSession()} />);
    expect(screen.getByText(/checking availability/i)).toBeInTheDocument();
  });

  it('classifies each date available / conflict / holiday and summarizes the count', async () => {
    const candidates = expandRecurringDates(SLOT, FROM, 8, '2026-12-31', false, []);
    // 8 Mondays from 2026-08-03.
    expect(candidates).toHaveLength(8);

    // A confirmed one_time session collides on the 2nd date.
    h.sessions = [
      {
        sessionId: 'c1',
        tutorUserId: 't1',
        status: 'confirmed',
        type: 'one_time',
        date: candidates[1],
        startTime: '17:00',
        endTime: '18:00',
        location: 'online',
      },
    ];
    // A school-holiday period swallows the 3rd date.
    h.periods = [{ startDate: candidates[2], endDate: candidates[2] }];

    renderWithProviders(<RecurringConflictPreview session={recurringSession()} />);

    // 8 total, 6 available (one conflict + one holiday removed).
    expect(await screen.findByText(/6 of 8/)).toBeInTheDocument();
    expect(screen.getAllByText('Available')).toHaveLength(6);
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/school holiday/i)).toBeInTheDocument();
    // Disclaimer — the callable is authoritative, conflicts skipped on accept.
    expect(screen.getByText(/skipped automatically/i)).toBeInTheDocument();
  });

  it('reads the CONFIGURED horizon: 2 weeks yields "2 of 2", not the default 8 (issue #250)', async () => {
    h.adminConfig = { recurringHorizonWeeks: 2 };
    renderWithProviders(<RecurringConflictPreview session={recurringSession()} />);
    // Weekly slot, 2-week horizon -> 2 candidates, both available -- the
    // preview predicts exactly what respondToSession will materialize
    // under the same key.
    expect(await screen.findByText(/2 of 2/)).toBeInTheDocument();
  });

  it('truncates the candidate window at the series end date', async () => {
    renderWithProviders(
      <RecurringConflictPreview session={recurringSession({ endDate: '2026-08-24' })} />,
    );
    // Only 2026-08-03/10/17/24 fall on/before the end date → 4 of 4 available.
    expect(await screen.findByText(/4 of 4/)).toBeInTheDocument();
    expect(screen.getAllByText('Available')).toHaveLength(4);
  });

  it('reflects a per-date custom override that closes the slot as a conflict', async () => {
    const candidates = expandRecurringDates(SLOT, FROM, 8, '2026-08-17', false, []);
    // Close the 17:00 slot only on the 2nd date via a custom override.
    const closed = openDay();
    for (let i = 68; i < 72; i++) closed[i] = false; // 17:00–18:00
    h.overrides = { [candidates[1]]: { type: 'custom', slots: closed } };

    renderWithProviders(
      <RecurringConflictPreview session={recurringSession({ endDate: '2026-08-17' })} />,
    );

    expect(await screen.findByText(/2 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });
});
