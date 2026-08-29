import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { DAYS_OF_WEEK, createEmptySlots } from '@ejm/sit-core';
import type { DayOfWeek } from '@ejm/sit-core';
import { ToastProvider } from '@ejm/shared-ui';

/**
 * Cancellation-policy section on the sitter SchedulePage (issue #237) — the
 * sit twin of study-web's tutor SchedulePage policy tests. The schedule
 * editor itself is smoke-tested only; the policy section saves via an
 * owner-editable updateDoc dot-path, independent of the schedule save flow.
 */
const h = vi.hoisted(() => ({
  schedule: {} as Record<string, unknown>,
  auth: {
    firebaseUser: { uid: 'b1' } as { uid: string } | null,
    userDoc: null as unknown,
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn<(ref: { path: string }, data: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve(),
  ),
}));

vi.mock('@/hooks/useSchedule', () => ({ useSchedule: () => h.schedule }));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => ({ periods: [], loading: false }) }));
vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: [ref: { path: string }, data: Record<string, unknown>]) =>
    h.updateDoc(...args),
}));

import '@/i18n';
import { SchedulePage } from '../SchedulePage';

function emptyWeekly() {
  return Object.fromEntries(
    DAYS_OF_WEEK.map((d) => [d, createEmptySlots()]),
  ) as Record<DayOfWeek, boolean[]>;
}

function makeUserDoc(policy?: number) {
  return {
    uid: 'b1',
    email: 'sitter@ejm-test.org',
    profiles: {
      babysitter: {
        ejemEmail: 'sitter@ejm-test.org',
        ...(policy !== undefined ? { cancellationNoticeHours: policy } : {}),
      },
    },
  };
}

function renderSchedule() {
  const router = createMemoryRouter(
    [{ path: '/babysitter/schedule', element: <SchedulePage /> }],
    { initialEntries: ['/babysitter/schedule'] },
  );
  return render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
}

afterEach(cleanup);

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
  h.auth.firebaseUser = { uid: 'b1' };
  h.auth.userDoc = makeUserDoc();
  h.auth.refreshUserDoc.mockClear();
  h.updateDoc.mockClear();
});

describe('sitter SchedulePage — cancellation policy (issue #237)', () => {
  it('renders the policy section alongside the schedule editor', () => {
    renderSchedule();
    expect(screen.getByText('Regular Availability')).toBeInTheDocument();
    expect(screen.getByText('Cancellation policy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save policy/i })).toBeInTheDocument();
  });

  it('seeds the selector from the stored value', () => {
    h.auth.userDoc = makeUserDoc(48);
    renderSchedule();
    const select = screen.getByRole('combobox', { name: /cancellation policy/i }) as HTMLSelectElement;
    expect(select.value).toBe('48');
  });

  it('defaults the selector to 0 (no policy) when the field is absent', () => {
    renderSchedule();
    const select = screen.getByRole('combobox', { name: /cancellation policy/i }) as HTMLSelectElement;
    expect(select.value).toBe('0');
  });

  it('saves the selected policy to the numeric dot-path and refreshes', async () => {
    renderSchedule();
    fireEvent.change(screen.getByRole('combobox', { name: /cancellation policy/i }), { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/b1' }),
        expect.objectContaining({ 'profiles.babysitter.cancellationNoticeHours': 48 }),
      ),
    );
    // The value is the NUMBER 48, never the string '48' (rules require int).
    const call = h.updateDoc.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)['profiles.babysitter.cancellationNoticeHours'] !== undefined,
    );
    expect((call?.[1] as Record<string, unknown>)['profiles.babysitter.cancellationNoticeHours']).toBe(48);
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('saves the 1-week (168) preset as its numeric value', async () => {
    renderSchedule();
    fireEvent.change(screen.getByRole('combobox', { name: /cancellation policy/i }), { target: { value: '168' } });
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/b1' }),
        expect.objectContaining({ 'profiles.babysitter.cancellationNoticeHours': 168 }),
      ),
    );
  });

  it('keeps the unsaved-policy guard alive across a schedule save (round-2 regression)', async () => {
    // PR #248 round 2: handleSave's blind setDirty(false) cancelled the
    // guard round 1 added -- Save Schedule with an unsaved policy choice
    // silently discarded it. The beforeunload guard is the observable:
    // preventDefault fires iff the page still counts itself dirty.
    renderSchedule();
    fireEvent.change(screen.getByRole('combobox', { name: /cancellation policy/i }), { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: /save schedule/i }));
    await waitFor(() => expect(h.schedule.saveWeekly).toHaveBeenCalled());

    const evt = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);

    // Saving the POLICY releases the guard.
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));
    // Wait for the saved toast -- it renders AFTER setSavedNoticeHours, so
    // the dirty recomputation has committed by then.
    await screen.findByText('Cancellation policy saved');
    await waitFor(() => {
      const evt2 = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evt2);
      expect(evt2.defaultPrevented).toBe(false);
    });
  });

  it('surfaces a policy save failure instead of a silent success', async () => {
    h.updateDoc.mockRejectedValueOnce(new Error('unavailable'));
    renderSchedule();
    fireEvent.change(screen.getByRole('combobox', { name: /cancellation policy/i }), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));
    await waitFor(() => expect(screen.getByText(/went wrong/i)).toBeInTheDocument());
  });
});
