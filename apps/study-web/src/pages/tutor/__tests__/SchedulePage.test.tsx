import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { DAYS_OF_WEEK, createEmptySlots } from '@ejm/shared-core';
import type { DayOfWeek } from '@ejm/shared-core';
import { ToastProvider } from '@ejm/shared-ui';
import { i18n } from '@/__tests__/test-utils';

// The schedule editor itself is smoke-tested only: the leaf components
// (WeeklyTimeline/DayEditor/OverrideList) have their own coverage in sync-sit's
// e2e suite; here we just prove the page wires the copied hooks and renders
// past the loading gate.
//
// The session-preferences and cancellation-policy sections moved here from
// AccountPage (issue #169) — their tests moved with them. Both save via
// owner-editable updateDoc dot-paths, independent of the schedule save flow.
const h = vi.hoisted(() => ({
  schedule: {} as Record<string, unknown>,
  holidays: {} as Record<string, unknown>,
  auth: {
    firebaseUser: { uid: 't1' } as { uid: string } | null,
    userDoc: null as unknown,
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn<(ref: { path: string }, data: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve(),
  ),
}));

vi.mock('@/hooks/useSchedule', () => ({ useSchedule: () => h.schedule }));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => h.holidays }));
vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => h.auth }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: [ref: { path: string }, data: Record<string, unknown>]) =>
    h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

import { SchedulePage } from '../SchedulePage';

function emptyWeekly() {
  return Object.fromEntries(
    DAYS_OF_WEEK.map((d) => [d, createEmptySlots()]),
  ) as Record<DayOfWeek, boolean[]>;
}

function makeUserDoc() {
  return {
    uid: 't1',
    email: 'login@ejm.org',
    profiles: {
      tutor: {
        enrollmentComplete: true,
        ejemEmail: 'alice.martin24@ejm.org',
      },
    },
  };
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
  h.auth.firebaseUser = { uid: 't1' };
  h.auth.userDoc = makeUserDoc();
  h.auth.refreshUserDoc.mockClear();
  h.updateDoc.mockClear();
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

  it('opts into the wide desktop tier on both return branches (issue #119)', () => {
    // The weekly timeline grid wants the 5xl cap; the shell's PageContainer
    // selects on this attribute sitting on the page ROOT (direct-child :has()).
    renderSchedule();
    expect(screen.getByText('Regular Availability').closest('[data-page-width="wide"]')).not.toBeNull();
    cleanup();
    h.schedule.loading = true;
    renderSchedule();
    expect(document.querySelector('[data-page-width="wide"]')).not.toBeNull();
  });

  it('renders the moved session-prefs and cancellation-policy sections (issue #169)', () => {
    renderSchedule();
    expect(screen.getByText('Session preferences')).toBeInTheDocument();
    expect(screen.getByText('Cancellation policy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save preferences/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save policy/i })).toBeInTheDocument();
  });

  // ── Cancellation policy (V2 feature 7 — moved from AccountPage) ──

  it('seeds the cancellation-policy selector from the stored value', () => {
    const userDoc = makeUserDoc();
    (userDoc.profiles.tutor as Record<string, unknown>).cancellationNoticeHours = 48;
    h.auth.userDoc = userDoc;
    renderSchedule();
    const select = screen.getByLabelText(/cancellation policy/i) as HTMLSelectElement;
    expect(select.value).toBe('48');
  });

  it('defaults the selector to 0 (no policy) when the field is absent', () => {
    renderSchedule();
    const select = screen.getByLabelText(/cancellation policy/i) as HTMLSelectElement;
    expect(select.value).toBe('0');
  });

  it('saves the selected policy to the numeric dot-path and refreshes', async () => {
    renderSchedule();
    fireEvent.change(screen.getByLabelText(/cancellation policy/i), { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/t1' }),
        expect.objectContaining({
          'profiles.tutor.cancellationNoticeHours': 48,
          updatedAt: 'ts',
        }),
      ),
    );
    // The value is the NUMBER 48, never the string '48'.
    const call = h.updateDoc.mock.calls.find(
      (c) => c[1]['profiles.tutor.cancellationNoticeHours'] !== undefined,
    );
    expect(call?.[1]['profiles.tutor.cancellationNoticeHours']).toBe(48);
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('saves the 1-week (168) preset as its numeric value', async () => {
    renderSchedule();
    fireEvent.change(screen.getByLabelText(/cancellation policy/i), { target: { value: '168' } });
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/t1' }),
        expect.objectContaining({ 'profiles.tutor.cancellationNoticeHours': 168 }),
      ),
    );
  });

  it('surfaces a policy save failure instead of a silent success', async () => {
    h.updateDoc.mockRejectedValueOnce(new Error('unavailable'));
    renderSchedule();
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));

    expect(await screen.findByText(/error|wrong/i)).toBeInTheDocument();
  });

  // ── Session preferences (issue #123 — moved from AccountPage) ──

  function seedSessionPrefs() {
    const userDoc = makeUserDoc();
    Object.assign(userDoc.profiles.tutor as Record<string, unknown>, {
      sessionLengthsMin: [45, 60],
      locationPrefs: ['online', 'family_home'],
      paddingMin: 15,
    });
    h.auth.userDoc = userDoc;
  }

  it('seeds the session-preferences section from the stored profile', () => {
    seedSessionPrefs();
    renderSchedule();

    expect(screen.getByRole('button', { name: '45 min', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '60 min', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 min', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '75 min', pressed: false })).toBeInTheDocument();

    expect(screen.getByLabelText('Online')).toBeChecked();
    expect(screen.getByLabelText("At the family's home")).toBeChecked();
    expect(screen.getByLabelText('At your home')).not.toBeChecked();
    expect(screen.getByLabelText('Library / public space')).not.toBeChecked();

    expect((screen.getByLabelText(/appointment padding/i) as HTMLInputElement).value).toBe('15');
  });

  it('renders the section without crashing when the fields are absent (legacy doc)', () => {
    renderSchedule();
    expect(screen.getByRole('button', { name: '45 min', pressed: false })).toBeInTheDocument();
    expect(screen.getByLabelText('Online')).not.toBeChecked();
    expect((screen.getByLabelText(/appointment padding/i) as HTMLInputElement).value).toBe('0');
  });

  it('saves exactly the three dot-paths (+updatedAt) with the edited values', async () => {
    seedSessionPrefs();
    renderSchedule();

    fireEvent.click(screen.getByRole('button', { name: '75 min' }));
    fireEvent.click(screen.getByLabelText('At your home'));
    fireEvent.change(screen.getByLabelText(/padding/i), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const call = h.updateDoc.mock.calls[0];
    expect(call[0]).toEqual(expect.objectContaining({ path: 'users/t1' }));
    const payload = call[1] as Record<string, unknown>;
    // Pin the FULL key set: dot-paths only — never a wholesale profiles.tutor
    // rewrite (would clobber server-owned siblings like approvedFamilies).
    // aboutMe stayed on AccountPage (issue #169 split it out of this save).
    expect(Object.keys(payload).sort()).toEqual([
      'profiles.tutor.locationPrefs',
      'profiles.tutor.paddingMin',
      'profiles.tutor.sessionLengthsMin',
      'updatedAt',
    ]);
    expect(payload['profiles.tutor.sessionLengthsMin']).toEqual([45, 60, 75]);
    expect(payload['profiles.tutor.locationPrefs']).toEqual(['online', 'family_home', 'tutor_home']);
    expect(payload['profiles.tutor.paddingMin']).toBe(30); // NUMBER, not '30'
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('blocks save when no session length is selected', async () => {
    seedSessionPrefs();
    renderSchedule();
    fireEvent.click(screen.getByRole('button', { name: '45 min' }));
    fireEvent.click(screen.getByRole('button', { name: '60 min' }));
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    expect(await screen.findByText(/at least one session length/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('blocks save when no location is selected', async () => {
    seedSessionPrefs();
    renderSchedule();
    fireEvent.click(screen.getByLabelText('Online'));
    fireEvent.click(screen.getByLabelText("At the family's home"));
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    expect(await screen.findByText(/at least one session location/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('surfaces a session-prefs save failure instead of a silent success', async () => {
    seedSessionPrefs();
    h.updateDoc.mockRejectedValueOnce(new Error('unavailable'));
    renderSchedule();
    fireEvent.click(await screen.findByRole('button', { name: /^save preferences$/i }));

    expect(await screen.findByText(/error|wrong/i)).toBeInTheDocument();
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();
  });

  it('rejects out-of-range padding before any write (UX guard; rules carry the bound)', async () => {
    const userDoc = makeUserDoc();
    (userDoc.profiles.tutor as Record<string, unknown>).sessionLengthsMin = [45, 60];
    (userDoc.profiles.tutor as Record<string, unknown>).locationPrefs = ['online'];
    (userDoc.profiles.tutor as Record<string, unknown>).paddingMin = 15;
    h.auth.userDoc = userDoc;
    renderSchedule();
    const padding = await screen.findByLabelText(/padding/i);
    fireEvent.change(padding, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /^save preferences$/i }));

    expect(await screen.findByText(/between 0 and 60/i)).toBeInTheDocument();
    const calls = h.updateDoc.mock.calls.filter((c) => JSON.stringify(c[1] ?? {}).includes('paddingMin'));
    expect(calls).toHaveLength(0);
  });

  // ── Coverage-requirement visibility (issue #167) ──
  // Warn + deep-link, never block: the page that owns locationPrefs must tell
  // an in-person tutor when their coverage area is empty (the search callable
  // silently excludes them otherwise).

  function seedPrefsWithArea(area: Record<string, unknown>, locationPrefs: string[]) {
    const userDoc = makeUserDoc();
    Object.assign(userDoc.profiles.tutor as Record<string, unknown>, {
      sessionLengthsMin: [45, 60],
      locationPrefs,
      paddingMin: 15,
      ...area,
    });
    h.auth.userDoc = userDoc;
  }

  it('warns with an area-page link when in-person prefs meet empty coverage', () => {
    seedPrefsWithArea({ areaMode: 'arrondissement', arrondissements: [] }, ['online', 'family_home']);
    renderSchedule();

    expect(screen.getByText(/can't find you for in-person sessions/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /set the area you cover/i })).toHaveAttribute(
      'href',
      '/tutor/area',
    );
  });

  it('warns for a distance-mode doc with no coordinates', () => {
    seedPrefsWithArea({ areaMode: 'distance', areaLatLng: null }, ['library']);
    renderSchedule();

    expect(screen.getByText(/can't find you for in-person sessions/i)).toBeInTheDocument();
  });

  it('warns when the stored areas are all unmappable legacy values (no MATCHABLE coverage)', () => {
    // 'Clamart' never matches a family address, so the tutor is invisible to
    // family_home searches despite a non-empty list — the warning must show.
    seedPrefsWithArea({ areaMode: 'arrondissement', arrondissements: ['Clamart'] }, ['family_home']);
    renderSchedule();

    expect(screen.getByText(/can't find you for in-person sessions/i)).toBeInTheDocument();
  });

  it('survives a non-string junk element in the stored areas (still warns, no crash)', () => {
    // Element types are not rules-guaranteed; a junk element must not
    // white-screen the schedule page. It is not matchable, so the tutor
    // still warns.
    seedPrefsWithArea({ areaMode: 'arrondissement', arrondissements: [42] }, ['family_home']);
    renderSchedule();

    expect(screen.getByText(/can't find you for in-person sessions/i)).toBeInTheDocument();
  });

  it('shows no warning for a legacy postcode doc (matchable after normalization)', () => {
    // '75016' normalizes to '16e', which searchTutors matches — covered.
    seedPrefsWithArea({ areaMode: 'arrondissement', arrondissements: ['75016'] }, ['family_home']);
    renderSchedule();

    expect(screen.queryByText(/can't find you for in-person sessions/i)).not.toBeInTheDocument();
  });

  it('shows no coverage warning for an online/tutor-home-only tutor', () => {
    seedPrefsWithArea({ areaMode: 'arrondissement', arrondissements: [] }, ['online', 'tutor_home']);
    renderSchedule();

    expect(screen.queryByText(/can't find you for in-person sessions/i)).not.toBeInTheDocument();
  });

  it('shows no coverage warning once coverage exists (either mode)', () => {
    seedPrefsWithArea({ areaMode: 'arrondissement', arrondissements: ['16e'] }, ['family_home']);
    const { unmount } = renderSchedule();
    expect(screen.queryByText(/can't find you for in-person sessions/i)).not.toBeInTheDocument();
    unmount();

    seedPrefsWithArea(
      { areaMode: 'distance', areaLatLng: { lat: 48.85, lng: 2.35 } },
      ['family_home'],
    );
    renderSchedule();
    expect(screen.queryByText(/can't find you for in-person sessions/i)).not.toBeInTheDocument();
  });

  it('keeps the prefs save SUCCESSFUL while the coverage warning shows (warn, never block)', async () => {
    seedPrefsWithArea({ areaMode: 'arrondissement', arrondissements: [] }, ['online', 'family_home']);
    renderSchedule();

    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    expect(screen.getByText(/can't find you for in-person sessions/i)).toBeInTheDocument();
  });

  it('prefs saves never touch the schedule save flow (separate save actions)', async () => {
    seedSessionPrefs();
    renderSchedule();
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    expect(h.schedule.saveWeekly).not.toHaveBeenCalled();
    expect(h.schedule.setHolidayMode).not.toHaveBeenCalled();
  });
});
