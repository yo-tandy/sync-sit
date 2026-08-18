import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// The propose page reads the tutor's OWN profile (session lengths / locations)
// and HINTS available start times from useSchedule's weekly grid (client-side —
// it must NOT call the parent-gated getTutorAvailability). Submit drives the
// proposeSession callable. Family context (familyId/subject/level) arrives via
// the route param + router state.
const h = vi.hoisted(() => ({
  userDoc: null as unknown,
  weekly: {} as Record<string, boolean[]>,
  weeklyLocations: undefined as Record<string, Record<string, string[]>> | undefined,
  params: { familyId: 'fam1' } as Record<string, string | undefined>,
  locState: null as unknown,
  callable: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ userDoc: h.userDoc }),
}));

vi.mock('@/hooks/useSchedule', () => ({
  useSchedule: () => ({ weekly: h.weekly, weeklyLocations: h.weeklyLocations }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => h.params,
    useLocation: () => ({ state: h.locState }),
    useNavigate: () => h.navigate,
  };
});

import { ProposeSessionPage } from '../ProposeSessionPage';

/** tutor2-style Monday grid: 16:00–20:00 (slots 64..79) available. */
function monGrid(): boolean[] {
  const g = new Array(96).fill(false);
  for (let i = 64; i < 80; i++) g[i] = true;
  return g;
}

function tutorDoc(overrides: Record<string, unknown> = {}) {
  return {
    uid: 't1',
    firstName: 'Yael',
    lastName: 'Cohen',
    status: 'active',
    profiles: {
      tutor: {
        enrollmentComplete: true,
        subjects: [{ subject: 'math', levels: ['6e'], rate: 25 }],
        sessionLengthsMin: [60],
        locationPrefs: ['online'],
        paddingMin: 15,
        ...overrides,
      },
    },
  };
}

// A far-future MONDAY (matches the weekly Monday grid). dayOfWeek('2027-06-07')='mon'.
const FUTURE_MON = '2027-06-07';

function reset() {
  h.userDoc = tutorDoc();
  h.weekly = { mon: monGrid() };
  h.weeklyLocations = undefined;
  h.params = { familyId: 'fam1' };
  h.locState = { familyName: 'Cohen', subject: 'math', level: '6e' };
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { sessionId: 'new-sess' } });
  h.navigate.mockReset();
}

describe('tutor ProposeSessionPage', () => {
  beforeEach(() => reset());

  it('sends an exact proposeSession payload and shows the success dialog', async () => {
    renderWithProviders(<ProposeSessionPage />);

    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: FUTURE_MON } });
    fireEvent.click(await screen.findByRole('button', { name: '16:00' }));
    fireEvent.click(screen.getByRole('button', { name: /send proposal/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('proposeSession', {
        familyId: 'fam1',
        subject: 'math',
        level: '6e',
        date: FUTURE_MON,
        startTime: '16:00',
        sessionLengthMinutes: 60,
        location: 'online',
      }),
    );
    expect(await screen.findByText(/proposal sent/i)).toBeInTheDocument();
  });

  it('includes a trimmed message when provided', async () => {
    renderWithProviders(<ProposeSessionPage />);
    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: '  see you then  ' } });
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: FUTURE_MON } });
    fireEvent.click(await screen.findByRole('button', { name: '16:00' }));
    fireEvent.click(screen.getByRole('button', { name: /send proposal/i }));

    await waitFor(() => {
      const call = h.callable.mock.calls.find((c) => c[0] === 'proposeSession');
      expect(call?.[1]).toMatchObject({ message: 'see you then' });
    });
  });

  it('surfaces a friendly slot-taken message on invalid-argument (no backend text)', async () => {
    h.callable.mockRejectedValue({ code: 'functions/invalid-argument' });
    renderWithProviders(<ProposeSessionPage />);

    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: FUTURE_MON } });
    fireEvent.click(await screen.findByRole('button', { name: '16:00' }));
    fireEvent.click(screen.getByRole('button', { name: /send proposal/i }));

    expect(await screen.findByText(/isn't available|pick another/i)).toBeInTheDocument();
  });

  it('shows a hint until a date is chosen, then hints times from the weekly grid', async () => {
    renderWithProviders(<ProposeSessionPage />);
    expect(screen.getByText(/choose a date/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: FUTURE_MON } });
    // 60-min chips from 16:00–20:00 → 16:00 offered, 19:00 the last fit.
    expect(await screen.findByRole('button', { name: '16:00' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '19:00' })).toBeInTheDocument();
  });

  it('renders the load-error guard when the family context is missing', async () => {
    h.locState = { familyName: 'Cohen' }; // no subject/level
    renderWithProviders(<ProposeSessionPage />);
    expect(screen.getByText(/could not open the proposal form/i)).toBeInTheDocument();
  });
});

// ── Per-slot location tags (issue #166): the tutor's own weekly tags
// constrain the location select for the armed start; without tags (legacy
// doc) the full profile prefs apply. ──
describe('tutor ProposeSessionPage — location tags', () => {
  beforeEach(() => {
    h.userDoc = tutorDoc({ locationPrefs: ['online', 'family_home'] });
    h.weekly = { mon: monGrid() };
    h.weeklyLocations = undefined;
    h.params = { familyId: 'fam1' };
    h.locState = { familyName: 'Cohen', subject: 'math', level: '6e' };
    h.callable.mockReset();
    h.callable.mockResolvedValue({ data: { sessionId: 'new-sess' } });
    h.navigate.mockReset();
  });

  function monTags(locations: string[]): Record<string, string[]> {
    const cells: Record<string, string[]> = {};
    for (let i = 64; i < 80; i++) cells[String(i)] = locations;
    return cells;
  }

  it('narrows the location options to the armed slot tags and proposes with it', async () => {
    h.weeklyLocations = { mon: monTags(['family_home']) };
    renderWithProviders(<ProposeSessionPage />);

    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: FUTURE_MON } });
    fireEvent.click(await screen.findByRole('button', { name: '16:00' }));

    const select = screen.getByLabelText(/location/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['family_home']);

    fireEvent.click(screen.getByRole('button', { name: /send proposal/i }));
    await waitFor(() => {
      const call = h.callable.mock.calls.find((c) => c[0] === 'proposeSession');
      expect(call?.[1]).toMatchObject({ location: 'family_home' });
    });
  });

  it('keeps the full profile prefs when the schedule has no tags (legacy doc)', async () => {
    renderWithProviders(<ProposeSessionPage />);
    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: FUTURE_MON } });
    fireEvent.click(await screen.findByRole('button', { name: '16:00' }));
    const select = screen.getByLabelText(/location/i) as HTMLSelectElement;
    // Both prefs remain; the armed set is canonicalized to LOCATION_PREFS order.
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['family_home', 'online']);
  });
});
