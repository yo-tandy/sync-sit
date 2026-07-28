import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Routes, Route } from 'react-router';
import i18n from '@/i18n';

// Hoisted, test-controllable state. The booking page reads the tutor's kids from
// families/{id}/kids (getDocs) and drives three callables by name via
// httpsCallable: getTutorAvailability, searchTutors (fallback), bookSession.
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 'p1' } as { uid: string } | null,
    userDoc: null as unknown,
  },
  kids: [] as { id: string; data: Record<string, unknown> }[],
  holidays: { periods: [] as { startDate: string; endDate: string }[], loading: false },
  getDocs: vi.fn(),
  // (name, payload) => Promise<{ data }>. Reassigned per test.
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('@/hooks/useHolidays', () => ({
  useHolidays: () => ({ ...h.holidays, schoolYear: '2026-2027' }),
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { BookSessionPage } from '../BookSessionPage';

function parent(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'p1',
    firstName: 'Dana',
    lastName: 'Cohen',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1', ...overrides } },
  };
}

/** Router state carried by the TutorCard entry point (full card data). */
function fullState(overrides: Record<string, unknown> = {}) {
  return {
    subject: 'math',
    level: '6e',
    rate: 25,
    sessionLengthsMin: [60, 30],
    locationPrefs: ['online', 'family_home'],
    tutorName: 'Alex',
    ...overrides,
  };
}

/** One availability page: 22 Jul has 14:00–15:00 free (indices 56..59). */
function availabilityPage() {
  const slots = new Array(96).fill(false);
  for (let i = 56; i < 60; i++) slots[i] = true;
  return { data: { dates: [{ date: '2026-07-22', slots }] } };
}

function renderBook(state: unknown, path = '/family/book/t1') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[{ pathname: path, state }]}>
        <Routes>
          <Route path="/family/book/:tutorUserId" element={<BookSessionPage />} />
          <Route path="/family/search" element={<div>SEARCH PAGE STUB</div>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function reset() {
  h.auth.firebaseUser = { uid: 'p1' };
  h.auth.userDoc = parent();
  h.kids = [
    { id: 'k1', data: { firstName: 'Noa', age: 10 } },
    { id: 'k2', data: { firstName: 'Eli', age: 8 } },
  ];
  h.holidays = { periods: [], loading: false };
  h.getDocs.mockReset();
  h.getDocs.mockImplementation(() =>
    Promise.resolve({ docs: h.kids.map((k) => ({ id: k.id, data: () => k.data })) }),
  );
  h.callable.mockReset();
  h.callable.mockImplementation((name: string) => {
    if (name === 'getTutorAvailability') return Promise.resolve(availabilityPage());
    if (name === 'bookSession') return Promise.resolve({ data: { sessionId: 's1' } });
    if (name === 'searchTutors') return Promise.resolve({ data: { results: [] } });
    return Promise.resolve({ data: {} });
  });
}

/** Pick the 14:00 chip and select the first student, arming the Book button. */
async function armBooking() {
  const chip = await screen.findByRole('button', { name: '14:00' });
  fireEvent.click(chip);
  const noa = await screen.findByLabelText(/Noa/);
  fireEvent.click(noa);
}

describe('family BookSessionPage', () => {
  beforeEach(() => reset());

  it('sends an exact one_time bookSession payload', async () => {
    renderBook(fullState());
    await armBooking();

    fireEvent.click(screen.getByRole('button', { name: /^Book session$/i }));

    await waitFor(() => {
      expect(h.callable).toHaveBeenCalledWith('bookSession', {
        tutorUserId: 't1',
        subject: 'math',
        level: '6e',
        date: '2026-07-22',
        startTime: '14:00',
        sessionLengthMinutes: 60,
        location: 'online',
        studentIds: ['k1'],
      });
    });
  });

  it('includes every selected student id in the payload', async () => {
    renderBook(fullState());
    await armBooking();
    fireEvent.click(await screen.findByLabelText(/Eli/));

    fireEvent.click(screen.getByRole('button', { name: /^Book session$/i }));

    await waitFor(() => {
      const call = h.callable.mock.calls.find((c) => c[0] === 'bookSession');
      expect(call?.[1]).toMatchObject({ studentIds: ['k1', 'k2'] });
    });
  });

  it('trims and includes a message, and omits it when blank', async () => {
    renderBook(fullState());
    await armBooking();
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: '  hello there  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Book session$/i }));

    await waitFor(() => {
      const call = h.callable.mock.calls.find((c) => c[0] === 'bookSession');
      expect(call?.[1]).toMatchObject({ message: 'hello there' });
    });
  });

  it('omits message from the payload when left empty', async () => {
    renderBook(fullState());
    await armBooking();
    fireEvent.click(screen.getByRole('button', { name: /^Book session$/i }));

    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('bookSession', expect.anything()));
    const call = h.callable.mock.calls.find((c) => c[0] === 'bookSession');
    expect(call?.[1]).not.toHaveProperty('message');
  });

  it('shows a success dialog naming the tutor on success', async () => {
    renderBook(fullState());
    await armBooking();
    fireEvent.click(screen.getByRole('button', { name: /^Book session$/i }));

    expect(await screen.findByText(/Alex.*must confirm|must confirm/i)).toBeInTheDocument();
  });

  it('re-fetches availability and shows a message when the slot was taken', async () => {
    renderBook(fullState());
    await armBooking();

    const before = h.callable.mock.calls.filter((c) => c[0] === 'getTutorAvailability').length;
    h.callable.mockImplementationOnce((name: string) => {
      if (name === 'bookSession') return Promise.reject({ code: 'functions/invalid-argument' });
      return Promise.resolve(availabilityPage());
    });
    fireEvent.click(screen.getByRole('button', { name: /^Book session$/i }));

    await waitFor(() => expect(screen.getByText(/no longer available|just been taken/i)).toBeInTheDocument());
    const after = h.callable.mock.calls.filter((c) => c[0] === 'getTutorAvailability').length;
    expect(after).toBeGreaterThan(before);
  });

  it('maps failed-precondition to one generic cannot-book message (no raw text)', async () => {
    renderBook(fullState());
    await armBooking();
    h.callable.mockImplementationOnce((name: string) => {
      if (name === 'bookSession')
        return Promise.reject({
          code: 'functions/failed-precondition',
          message: 'Tutor does not offer this session length',
        });
      return Promise.resolve(availabilityPage());
    });
    fireEvent.click(screen.getByRole('button', { name: /^Book session$/i }));

    await waitFor(() =>
      expect(screen.getByText(/could not be booked|cannot be booked/i)).toBeInTheDocument(),
    );
    // Never leak the raw backend message.
    expect(screen.queryByText(/does not offer this session length/i)).not.toBeInTheDocument();
  });

  it('renders the friendly request-contact-first screen on permission-denied availability', async () => {
    h.callable.mockImplementation((name: string) => {
      if (name === 'getTutorAvailability')
        return Promise.reject({ code: 'functions/permission-denied' });
      return Promise.resolve({ data: {} });
    });
    renderBook(fullState());

    expect(await screen.findByText(/request contact/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /find a tutor|back to search|search/i });
    expect(link).toHaveAttribute('href', '/family/search');
  });

  it('re-derives chips when the session length changes', async () => {
    renderBook(fullState());
    // 60-min over a four-slot free block (14:00–15:00): exactly one start (14:00).
    // 30-min: 14:00,14:15,14:30 — but NOT 14:45 (it would need the busy 15:00 slot).
    expect(await screen.findByRole('button', { name: '14:00' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '14:30' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/session length/i), { target: { value: '30' } });

    expect(await screen.findByRole('button', { name: '14:30' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '14:15' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '14:45' })).not.toBeInTheDocument();
  });

  // ── Cancellation policy note (V2 feature 7) ──
  it('shows a cancellation-policy note when the tutor has a policy', async () => {
    renderBook(fullState({ cancellationNoticeHours: 48 }));
    expect(await screen.findByText(/48h notice to cancel/i)).toBeInTheDocument();
  });

  it('shows no cancellation-policy note when the tutor has none (0)', async () => {
    renderBook(fullState({ cancellationNoticeHours: 0 }));
    await screen.findByRole('button', { name: '14:00' });
    expect(screen.queryByText(/notice to cancel/i)).not.toBeInTheDocument();
  });

  it('does not send cancellationNoticeHours in the bookSession payload', async () => {
    renderBook(fullState({ cancellationNoticeHours: 48 }));
    await armBooking();
    fireEvent.click(screen.getByRole('button', { name: /^Book session$/i }));

    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('bookSession', expect.anything()));
    const call = h.callable.mock.calls.find((c) => c[0] === 'bookSession');
    expect(call?.[1]).not.toHaveProperty('cancellationNoticeHours');
  });

  it('falls back to searchTutors for card data when router state lacks it (deep link)', async () => {
    h.callable.mockImplementation((name: string) => {
      if (name === 'getTutorAvailability') return Promise.resolve(availabilityPage());
      if (name === 'bookSession') return Promise.resolve({ data: { sessionId: 's1' } });
      if (name === 'searchTutors')
        return Promise.resolve({
          data: {
            results: [
              {
                uid: 't1',
                firstName: 'Alex',
                lastName: 'Roy',
                subject: 'math',
                level: '6e',
                rate: 25,
                sessionLengthsMin: [60],
                locationPrefs: ['online'],
                languages: [],
                classLevel: 'Terminale',
                levels: ['6e'],
                distance: null,
                endorsementCount: 0,
                requestStatus: 'accepted',
              },
            ],
          },
        });
      return Promise.resolve({ data: {} });
    });
    // Deep-link state: only subject/level (from the request doc), no card data.
    renderBook({ subject: 'math', level: '6e' });

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith(
        'searchTutors',
        expect.objectContaining({ subject: 'math', level: '6e' }),
      ),
    );
    // The tutor's session length feeds the calendar chips.
    expect(await screen.findByRole('button', { name: '14:00' })).toBeInTheDocument();
  });
});

/** A weekly availability window: four Mondays, each with 14:00–15:00 free. */
function weeklyWindow() {
  const slots = new Array(96).fill(false);
  for (let i = 56; i < 60; i++) slots[i] = true;
  return {
    data: {
      dates: ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'].map((date) => ({
        date,
        slots,
      })),
    },
  };
}

/** Switch to weekly mode and select the offered Monday 14:00 slot. */
async function armWeekly() {
  fireEvent.click(await screen.findByRole('button', { name: /^Weekly$/i }));
  const chip = await screen.findByRole('button', { name: /Monday.*14:00/ });
  fireEvent.click(chip);
  fireEvent.click(await screen.findByLabelText(/Noa/));
}

describe('family BookSessionPage — weekly mode', () => {
  beforeEach(() => {
    reset();
    // getTutorAvailability serves the 4-Monday window for weekly derivation.
    h.callable.mockImplementation((name: string) => {
      if (name === 'getTutorAvailability') return Promise.resolve(weeklyWindow());
      if (name === 'bookSession') return Promise.resolve({ data: { sessionId: 's1' } });
      return Promise.resolve({ data: {} });
    });
  });

  it('sends an exact recurring bookSession payload (schoolWeeksOnly default true, endDate omitted)', async () => {
    renderBook(fullState());
    await armWeekly();
    fireEvent.click(screen.getByRole('button', { name: /request weekly/i }));

    await waitFor(() => {
      const call = h.callable.mock.calls.find((c) => c[0] === 'bookSession');
      expect(call?.[1]).toEqual({
        tutorUserId: 't1',
        subject: 'math',
        level: '6e',
        type: 'recurring',
        recurringSlot: { day: 'mon', startTime: '14:00' },
        schoolWeeksOnly: true,
        sessionLengthMinutes: 60,
        location: 'online',
        studentIds: ['k1'],
      });
    });
  });

  it('includes endDate in the payload only when set', async () => {
    renderBook(fullState());
    await armWeekly();
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: /request weekly/i }));

    await waitFor(() => {
      const call = h.callable.mock.calls.find((c) => c[0] === 'bookSession');
      expect(call?.[1]).toMatchObject({ endDate: '2026-12-31' });
    });
  });

  it('includes trialFirstSession in the payload only when the toggle is on', async () => {
    renderBook(fullState());
    await armWeekly();
    fireEvent.click(screen.getByLabelText(/first session a trial/i));
    fireEvent.click(screen.getByRole('button', { name: /request weekly/i }));

    await waitFor(() => {
      const call = h.callable.mock.calls.find((c) => c[0] === 'bookSession');
      expect(call?.[1]).toMatchObject({ trialFirstSession: true });
    });
  });

  it('omits trialFirstSession when the toggle is off (default, omit-when-false)', async () => {
    renderBook(fullState());
    await armWeekly();
    fireEvent.click(screen.getByRole('button', { name: /request weekly/i }));

    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('bookSession', expect.anything()));
    const call = h.callable.mock.calls.find((c) => c[0] === 'bookSession');
    expect(call?.[1]).not.toHaveProperty('trialFirstSession');
  });

  it('marks the first non-greyed projected date as a trial when the toggle is on', async () => {
    renderBook(fullState());
    await armWeekly();
    // No trial marker until the family opts in.
    expect(screen.queryByText(/^Trial$/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/first session a trial/i));
    // Exactly one projected date is flagged as the trial.
    const marks = await screen.findAllByText(/^Trial$/);
    expect(marks).toHaveLength(1);
  });

  it('preserves shared form state (students, length) across a mode toggle', async () => {
    renderBook(fullState());
    // In one-time mode, pick a student and a 30-min length.
    fireEvent.click(await screen.findByLabelText(/Noa/));
    fireEvent.change(screen.getByLabelText(/session length/i), { target: { value: '30' } });

    // Toggle to weekly — the student + length selections must survive.
    fireEvent.click(screen.getByRole('button', { name: /^Weekly$/i }));

    expect((screen.getByLabelText(/Noa/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/session length/i) as HTMLSelectElement).value).toBe('30');
  });

  it('greys holiday dates in the projection when schoolWeeksOnly is on', async () => {
    // Every date falls in a holiday period → all projected dates are skipped.
    h.holidays = { periods: [{ startDate: '2000-01-01', endDate: '2100-12-31' }], loading: false };
    renderBook(fullState());
    await armWeekly();

    expect(await screen.findAllByText(/school holidays/i)).not.toHaveLength(0);

    // Turning schoolWeeksOnly off keeps holiday dates in the series (no skip copy).
    fireEvent.click(screen.getByLabelText(/school-holiday weeks/i));
    await waitFor(() => expect(screen.queryByText(/school holidays/i)).not.toBeInTheDocument());
  });

  it('defaults schoolWeeksOnly to checked', async () => {
    renderBook(fullState());
    await armWeekly();
    expect((screen.getByLabelText(/school-holiday weeks/i) as HTMLInputElement).checked).toBe(true);
  });

  it('shows a weekly-cadence success dialog naming the tutor', async () => {
    renderBook(fullState());
    await armWeekly();
    fireEvent.click(screen.getByRole('button', { name: /request weekly/i }));

    // The weekly success copy states the cadence + that the tutor confirms.
    expect(await screen.findByText(/must confirm/i)).toBeInTheDocument();
    expect(await screen.findByText(/Mondays at 14:00|once accepted/i)).toBeInTheDocument();
  });
});
