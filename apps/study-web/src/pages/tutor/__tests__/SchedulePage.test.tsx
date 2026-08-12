import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { DAYS_OF_WEEK, createEmptySlots } from '@ejm/shared-core';
import type { DayOfWeek } from '@ejm/shared-core';
import { ToastProvider } from '@ejm/shared-ui';
import { i18n } from '@/__tests__/test-utils';

// Smoke test only. The schedule leaf components (WeeklyTimeline/DayEditor/
// OverrideList) have their own coverage in sync-sit's e2e suite; here we just
// prove the page wires the copied hooks and renders past the loading gate.
const h = vi.hoisted(() => ({
  schedule: {} as Record<string, unknown>,
  holidays: {} as Record<string, unknown>,
}));

vi.mock('@/hooks/useSchedule', () => ({ useSchedule: () => h.schedule }));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => h.holidays }));

import { SchedulePage } from '../SchedulePage';

function emptyWeekly() {
  return Object.fromEntries(
    DAYS_OF_WEEK.map((d) => [d, createEmptySlots()]),
  ) as Record<DayOfWeek, boolean[]>;
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

beforeEach(() => {
  h.schedule = {
    weekly: emptyWeekly(),
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
});

describe('tutor SchedulePage', () => {
  it('renders the schedule editor once the hooks have loaded', () => {
    renderSchedule();
    expect(screen.getByText('Regular Availability')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save schedule/i })).toBeInTheDocument();
  });

  it('shows a spinner while the schedule is still loading', () => {
    h.schedule.loading = true;
    renderSchedule();
    expect(screen.queryByText('Regular Availability')).not.toBeInTheDocument();
  });
});
