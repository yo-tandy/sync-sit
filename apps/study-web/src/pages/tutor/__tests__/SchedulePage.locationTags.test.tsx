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
    profiles: { tutor: { enrollmentComplete: true, ejemEmail: 'a@ejm.org' } },
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
