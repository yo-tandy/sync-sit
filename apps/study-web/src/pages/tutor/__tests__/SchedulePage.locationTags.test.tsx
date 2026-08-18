import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { DAYS_OF_WEEK, createEmptySlots } from '@ejm/shared-core';
import type { DayOfWeek } from '@ejm/shared-core';
import { ToastProvider, DayEditor } from '@ejm/shared-ui';
import { i18n } from '@/__tests__/test-utils';

// Per-slot location tags (issue #166) — the weekly DayEditor gains an optional
// per-range tag control; tags ride the schedule save as a sparse
// weeklyLocations map (day -> slotIdx -> locations). The DayEditor extension is
// prop-gated: WITHOUT locationTags it renders exactly as before (the sit
// babysitter SchedulePage passes nothing — parity pin at the bottom).
const h = vi.hoisted(() => ({
  schedule: {} as Record<string, unknown>,
  holidays: {} as Record<string, unknown>,
  auth: {
    firebaseUser: { uid: 't1' } as { uid: string } | null,
    userDoc: null as unknown,
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/hooks/useSchedule', () => ({ useSchedule: () => h.schedule }));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => h.holidays }));
vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

import { SchedulePage } from '../SchedulePage';

function emptyWeekly() {
  return Object.fromEntries(
    DAYS_OF_WEEK.map((d) => [d, createEmptySlots()]),
  ) as Record<DayOfWeek, boolean[]>;
}

// Monday 16:00-20:00 = slots 64..79 active.
function mondayWeekly() {
  const weekly = emptyWeekly();
  for (let i = 64; i < 80; i++) weekly.mon[i] = true;
  return weekly;
}

function monCells(locations: string[]): Record<string, string[]> {
  const cells: Record<string, string[]> = {};
  for (let i = 64; i < 80; i++) cells[String(i)] = locations;
  return cells;
}

function renderSchedule() {
  const router = createMemoryRouter(
    [{ path: '/tutor/schedule', element: <SchedulePage /> }],
    { initialEntries: ['/tutor/schedule'] },
  );
  return render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </I18nextProvider>,
  );
}

function openMondayEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
  // The range row proves the editor is open on the right day.
  expect(screen.getByText('16:00 – 20:00')).toBeTruthy();
}

const defaultsChip = () => screen.getByRole('button', { name: 'Profile defaults' });
const onlineChip = () =>
  screen.getAllByRole('button', { name: 'Online' })[0]; // chips live in the dialog

beforeEach(() => {
  h.schedule = {
    weekly: mondayWeekly(),
    weeklyLocations: undefined,
    holidayMode: 'same',
    holidaySchedules: {},
    holidayNotes: '',
    overrides: [],
    loading: false,
    saveWeekly: vi.fn(() => Promise.resolve()),
    setHolidayMode: vi.fn(() => Promise.resolve()),
    addOverride: vi.fn(() => Promise.resolve()),
    removeOverride: vi.fn(() => Promise.resolve()),
  };
  h.holidays = { periods: [], loading: false };
  h.auth.firebaseUser = { uid: 't1' };
  h.auth.userDoc = {
    uid: 't1',
    email: 'login@ejm.org',
    profiles: {
      tutor: {
        enrollmentComplete: true,
        ejemEmail: 'a@ejm.org',
        // Chip options derive from the tutor's offered prefs (PR #185 r2).
        locationPrefs: ['online', 'family_home'],
      },
    },
  };
  h.updateDoc.mockClear();
});

describe('SchedulePage per-slot location tags', () => {
  it('legacy doc (no weeklyLocations) renders with the defaults state selected', () => {
    renderSchedule();
    openMondayEditor();
    expect(defaultsChip().getAttribute('aria-pressed')).toBe('true');
    expect(onlineChip().getAttribute('aria-pressed')).toBe('false');
  });

  it('tags a range and saves the sparse per-cell payload', async () => {
    renderSchedule();
    openMondayEditor();
    fireEvent.click(onlineChip());
    expect(onlineChip().getAttribute('aria-pressed')).toBe('true');
    expect(defaultsChip().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
    await waitFor(() => {
      expect(h.schedule.saveWeekly).toHaveBeenCalledTimes(1);
    });
    expect(h.schedule.saveWeekly).toHaveBeenCalledWith(
      expect.anything(),
      { mon: monCells(['online']) },
    );
  });

  it('saves an empty map when no range is tagged (all defaults)', async () => {
    renderSchedule();
    openMondayEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
    await waitFor(() => {
      expect(h.schedule.saveWeekly).toHaveBeenCalledWith(expect.anything(), {});
    });
  });

  it('loads stored tags into the chip state and drops junk cells on save', async () => {
    h.schedule.weeklyLocations = {
      mon: {
        ...monCells(['online']),
        '999': ['online'], // out of range — sanitized away
        abc: ['zoom'], // junk key + junk value — sanitized away
      },
    };
    renderSchedule();
    openMondayEditor();
    expect(onlineChip().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
    await waitFor(() => {
      expect(h.schedule.saveWeekly).toHaveBeenCalledWith(
        expect.anything(),
        { mon: monCells(['online']) },
      );
    });
  });

  it('renders a merged range with disagreeing cells as MIXED — no chip pressed, cells kept on save', async () => {
    // Reviewer repro (PR #185): tag 16:00-18:00 online, then add 18:00-20:00;
    // the two ranges merge into one 16:00-20:00 row whose covered cells
    // disagree. That must NOT display as "Profile defaults" (a false state) —
    // it renders as a third, mixed state and saving keeps the stored cells
    // untouched.
    h.schedule.weekly = (() => {
      const weekly = emptyWeekly();
      for (let i = 64; i < 72; i++) weekly.mon[i] = true; // 16:00-18:00 only
      return weekly;
    })();
    renderSchedule();
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    expect(screen.getByText('16:00 – 18:00')).toBeTruthy();
    fireEvent.click(onlineChip());
    // Merge in 18:00-20:00 via the add-range control.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '20:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('16:00 – 20:00')).toBeTruthy();
    // Mixed state: NEITHER the defaults chip nor any category chip pressed.
    expect(defaultsChip().getAttribute('aria-pressed')).toBe('false');
    expect(onlineChip().getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(/combines different location choices/i)).toBeTruthy();
    // Saving without picking a state keeps the cells exactly as stored.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
    await waitFor(() => {
      expect(h.schedule.saveWeekly).toHaveBeenCalledWith(expect.anything(), {
        mon: Object.fromEntries(
          Array.from({ length: 8 }, (_, k) => [String(64 + k), ['online']]),
        ),
      });
    });
  });

  it('picking a chip on a mixed range unifies the whole range to it', () => {
    // Stored tags cover only 16:00-18:00 of an active 16:00-20:00 range.
    h.schedule.weeklyLocations = {
      mon: Object.fromEntries(
        Array.from({ length: 8 }, (_, k) => [String(64 + k), ['online']]),
      ),
    };
    renderSchedule();
    openMondayEditor();
    expect(defaultsChip().getAttribute('aria-pressed')).toBe('false'); // mixed
    fireEvent.click(onlineChip());
    // Unified: the chip now presses for the WHOLE range (no longer mixed).
    expect(onlineChip().getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText(/combines different location choices/i)).toBeNull();
  });

  it('surfaces an error and keeps dirty state when the schedule save rejects', async () => {
    h.schedule.saveWeekly = vi.fn(() => Promise.reject(new Error('offline')));
    renderSchedule();
    openMondayEditor();
    fireEvent.click(onlineChip());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
    expect(await screen.findByText('An error occurred')).toBeTruthy();
    // No success toast — the save did not go through.
    expect(screen.queryByText(/schedule saved/i)).toBeNull();
  });

  it('offers only chips for the tutor current location prefs', () => {
    // Prefs are online+family_home: no chip for a location the tutor does
    // not offer, so a tag can only narrow within the offered set.
    renderSchedule();
    openMondayEditor();
    expect(onlineChip()).toBeTruthy();
    expect(screen.getAllByRole('button', { name: "At the family's home" })[0]).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'At your home' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Library / public space' })).toBeNull();
  });

  it('keeps a stored outside-prefs tag visible and flagged, and preserves it on save', async () => {
    // Prefs narrowed to online AFTER the range was tagged family_home: the
    // stored tag renders as a checked-but-flagged chip with a hint (never
    // silently dropped — #175 tolerance precedent), and saving without
    // touching it preserves the cells.
    (h.auth.userDoc as { profiles: { tutor: { locationPrefs: string[] } } }).profiles.tutor.locationPrefs =
      ['online'];
    h.schedule.weeklyLocations = { mon: monCells(['family_home']) };
    renderSchedule();
    openMondayEditor();
    const flagged = screen.getAllByRole('button', { name: "At the family's home" })[0];
    expect(flagged.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/no longer offer in your session preferences/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
    await waitFor(() => {
      expect(h.schedule.saveWeekly).toHaveBeenCalledWith(
        expect.anything(),
        { mon: monCells(['family_home']) },
      );
    });
  });

  it('unchecking a flagged outside-prefs tag removes it from the save', async () => {
    (h.auth.userDoc as { profiles: { tutor: { locationPrefs: string[] } } }).profiles.tutor.locationPrefs =
      ['online'];
    h.schedule.weeklyLocations = { mon: monCells(['family_home']) };
    renderSchedule();
    openMondayEditor();
    fireEvent.click(screen.getAllByRole('button', { name: "At the family's home" })[0]);
    // Untagged back to defaults; the flagged chip and hint are gone.
    expect(screen.queryByRole('button', { name: "At the family's home" })).toBeNull();
    expect(screen.queryByText(/no longer offer in your session preferences/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
    await waitFor(() => {
      expect(h.schedule.saveWeekly).toHaveBeenCalledWith(expect.anything(), {});
    });
  });

  it('untags a range back to defaults and saves without it', async () => {
    h.schedule.weeklyLocations = { mon: monCells(['online']) };
    renderSchedule();
    openMondayEditor();
    fireEvent.click(defaultsChip());
    expect(defaultsChip().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Schedule' }));
    await waitFor(() => {
      expect(h.schedule.saveWeekly).toHaveBeenCalledWith(expect.anything(), {});
    });
  });
});

describe('DayEditor without locationTags (sit parity)', () => {
  it('renders no tag controls and saves with the two-arg shape', () => {
    const onSave = vi.fn();
    const slots = createEmptySlots();
    for (let i = 64; i < 80; i++) slots[i] = true;
    render(
      <I18nextProvider i18n={i18n}>
        <DayEditor day="mon" slots={slots} open onClose={() => {}} onSave={onSave} />
      </I18nextProvider>,
    );
    expect(screen.getByText('16:00 – 20:00')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Profile defaults' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Online' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith('mon', slots);
  });
});
