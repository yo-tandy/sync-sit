/**
 * L4: useSchedule oracle-diff test.
 *
 * Gate 2 of the Phase -1 lint-cleanup verification sub-checklist (see
 * docs/agent-runs/agent-8-test-plan.md §3 row L4). Trickiest of the
 * 5 hooks because it subscribes to TWO snapshot channels (the schedule
 * document at `schedules/{uid}` and the overrides collection at
 * `schedules/{uid}/overrides`) and tracks the loading flag on the
 * schedule channel only.
 *
 * Post-cleanup pattern (read from apps/web/src/hooks/useSchedule.ts
 * after merge 8e1272f):
 *   - useState<boolean>(Boolean(uid)) — loading initialises from uid.
 *   - useEffect deps on [uid]: `if (!uid) return;` — no setLoading in
 *     the effect body.
 *   - Schedule onSnapshot callback: setSchedule(snap.exists() ?
 *     snap.data() : null) then setLoading(false).
 *   - Overrides onSnapshot callback: setOverrides(items.sort by date) —
 *     NO setLoading.
 *   - Effect cleanup calls BOTH unsubs.
 * Loading flips on the schedule channel only; overrides arriving first
 * does NOT flip loading.
 *
 * Same loading-transition consequences as L1–L3: sign-in via rerender
 * does NOT produce a transient loading=true frame; useState retains.
 *
 * Owned by agent-8-tester. Do not modify production code on failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  DAYS_OF_WEEK,
  createEmptySlots,
  type DayOfWeek,
} from '@ejm/sit-core';
import { diffFrames } from './_helpers/replayHook';

// --- vi.hoisted state for mocks ---------------------------------------------

const { authState, snapState } = vi.hoisted(() => ({
  authState: { firebaseUser: null as { uid: string } | null },
  snapState: {
    // useSchedule subscribes twice — index 0 = schedule doc, index 1 =
    // overrides collection. Callbacks captured in subscription order.
    callbacks: [] as Array<(snap: unknown) => void>,
    unsubCount: 0,
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T>(selector: (s: typeof authState) => T) => selector(authState),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ __doc: path }),
  collection: (_db: unknown, ...path: string[]) => ({ __collection: path }),
  query: (c: unknown, ...rest: unknown[]) => ({ __query: { c, rest } }),
  where: (field: string, op: string, val: unknown) => ({
    __where: { field, op, val },
  }),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  serverTimestamp: () => ({ __serverTimestamp: true }),
  onSnapshot: (_q: unknown, cb: (snap: unknown) => void) => {
    snapState.callbacks.push(cb);
    return () => {
      snapState.unsubCount++;
    };
  },
}));

import { useSchedule } from '@/hooks/useSchedule';

// --- helpers ----------------------------------------------------------------

function buildDefaultWeekly(): Record<DayOfWeek, boolean[]> {
  const out = {} as Record<DayOfWeek, boolean[]>;
  for (const day of DAYS_OF_WEEK) {
    out[day] = createEmptySlots();
  }
  return out;
}

function buildCustomWeekly(): Record<DayOfWeek, boolean[]> {
  const out = buildDefaultWeekly();
  // Mark Tuesday 08:00–09:00 available (slot indices 32–35 at 15-min
  // granularity).
  const tue = [...out.tue];
  tue[32] = true;
  tue[33] = true;
  tue[34] = true;
  tue[35] = true;
  out.tue = tue;
  return out;
}

function fireScheduleSnap(snap: { exists: () => boolean; data: () => unknown }) {
  const cb = snapState.callbacks[0];
  if (!cb) throw new Error('schedule snapshot callback not registered');
  cb(snap);
}

function fireOverridesSnap(
  docs: Array<{ id: string; data: unknown }>,
) {
  const cb = snapState.callbacks[1];
  if (!cb) throw new Error('overrides snapshot callback not registered');
  cb({
    docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
  });
}

type Frame = {
  loading: boolean;
  weekly: Record<DayOfWeek, boolean[]>;
  holidayMode: string;
  holidaySchedules: unknown;
  overrides: unknown[];
};

function captureFrame(result: {
  current: ReturnType<typeof useSchedule>;
}): Frame {
  return {
    loading: result.current.loading,
    weekly: result.current.weekly,
    holidayMode: result.current.holidayMode,
    holidaySchedules: result.current.holidaySchedules,
    overrides: result.current.overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  authState.firebaseUser = null;
  snapState.callbacks = [];
  snapState.unsubCount = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// --- fixtures ---------------------------------------------------------------

const defaultWeekly = buildDefaultWeekly();
const customWeekly = buildCustomWeekly();

const scheduleDocFull = {
  userId: 'a',
  weekly: customWeekly,
  holidayMode: 'different' as const,
  holidaySchedules: {
    summer: buildDefaultWeekly(),
  },
};

// Two overrides on unsorted dates; expected sorted output is 05-10 first.
const ovEarly = {
  type: 'unavailable' as const,
  reason: 'manual' as const,
};
const ovLate = {
  type: 'custom' as const,
  reason: 'manual' as const,
  slots: createEmptySlots(),
};

// --- tests ------------------------------------------------------------------

describe('L4: useSchedule — Gate 2 oracle-diff', () => {
  it('cold mount with uid=undefined: loading=false, default weekly, no subscriptions', async () => {
    const { result, unmount } = renderHook(() => useSchedule());
    await act(async () => {});

    const oracle: Frame[] = [
      {
        loading: false,
        weekly: defaultWeekly,
        holidayMode: 'same',
        holidaySchedules: undefined,
        overrides: [],
      },
    ];
    const diff = diffFrames(
      [captureFrame(result)],
      oracle,
      'L4 cold-mount-no-uid',
    );
    expect(diff.ok, diff.message).toBe(true);
    expect(snapState.callbacks).toHaveLength(0);

    unmount();
  });

  it('cold mount with uid="a": both subscriptions registered; schedule-missing → loading flips on schedule channel; overrides sort; full schedule overrides defaults', async () => {
    authState.firebaseUser = { uid: 'a' };
    const { result, unmount } = renderHook(() => useSchedule());
    await act(async () => {});

    expect(snapState.callbacks).toHaveLength(2);
    const frames: Frame[] = [captureFrame(result)];

    // Schedule snap missing → setSchedule(null) → weekly stays at
    // default fallback; loading flips to false.
    await act(async () => {
      fireScheduleSnap({ exists: () => false, data: () => undefined });
    });
    frames.push(captureFrame(result));

    // Overrides snap with two items, dates out of order. Output must
    // be sorted ascending by date string.
    await act(async () => {
      fireOverridesSnap([
        { id: '2026-05-20', data: ovLate },
        { id: '2026-05-10', data: ovEarly },
      ]);
    });
    frames.push(captureFrame(result));

    // Schedule snap with full doc — weekly + holidayMode + holidaySchedules
    // now reflect the document. Loading remains false (already false).
    await act(async () => {
      fireScheduleSnap({
        exists: () => true,
        data: () => scheduleDocFull,
      });
    });
    frames.push(captureFrame(result));

    const sortedOverrides = [
      { ...ovEarly, date: '2026-05-10' },
      { ...ovLate, date: '2026-05-20' },
    ];

    const oracle: Frame[] = [
      // Frame 0: just-mounted with uid; both subscriptions registered
      // but no snaps fired yet. Loading=true (Boolean('a')).
      {
        loading: true,
        weekly: defaultWeekly,
        holidayMode: 'same',
        holidaySchedules: undefined,
        overrides: [],
      },
      // Frame 1: schedule snap missing → loading flips, weekly fallback.
      {
        loading: false,
        weekly: defaultWeekly,
        holidayMode: 'same',
        holidaySchedules: undefined,
        overrides: [],
      },
      // Frame 2: overrides snap arrives, sorted ascending.
      {
        loading: false,
        weekly: defaultWeekly,
        holidayMode: 'same',
        holidaySchedules: undefined,
        overrides: sortedOverrides,
      },
      // Frame 3: schedule snap with full doc → weekly/holidayMode/holidaySchedules
      // come from the doc.
      {
        loading: false,
        weekly: customWeekly,
        holidayMode: 'different',
        holidaySchedules: scheduleDocFull.holidaySchedules,
        overrides: sortedOverrides,
      },
    ];

    const diff = diffFrames(frames, oracle, 'L4 mount + 2-channel flow');
    expect(diff.ok, diff.message).toBe(true);

    unmount();
  });

  it('sign-out: state retained on both channels; BOTH unsubs fire exactly once', async () => {
    authState.firebaseUser = { uid: 'a' };
    const { result, rerender, unmount } = renderHook(() => useSchedule());
    await act(async () => {});

    await act(async () => {
      fireScheduleSnap({
        exists: () => true,
        data: () => scheduleDocFull,
      });
      fireOverridesSnap([{ id: '2026-05-10', data: ovEarly }]);
    });
    const frame1 = captureFrame(result);

    authState.firebaseUser = null;
    await act(async () => {
      rerender();
    });
    const frame2 = captureFrame(result);

    const sortedOverrides = [{ ...ovEarly, date: '2026-05-10' }];

    const oracle: Frame[] = [
      {
        loading: false,
        weekly: customWeekly,
        holidayMode: 'different',
        holidaySchedules: scheduleDocFull.holidaySchedules,
        overrides: sortedOverrides,
      },
      // State retained on sign-out: no setSchedule(null) or
      // setOverrides([]) call in cleanup.
      {
        loading: false,
        weekly: customWeekly,
        holidayMode: 'different',
        holidaySchedules: scheduleDocFull.holidaySchedules,
        overrides: sortedOverrides,
      },
    ];

    const diff = diffFrames([frame1, frame2], oracle, 'L4 sign-out retains both');
    expect(diff.ok, diff.message).toBe(true);
    // Both unsubs fired exactly once on the cleanup.
    expect(snapState.unsubCount).toBe(2);

    unmount();
  });

  it('sign-in via rerender (uid undefined → "a"): loading STAYS false; 2 new subscriptions registered', async () => {
    const { result, rerender, unmount } = renderHook(() => useSchedule());
    await act(async () => {});
    const frame1 = captureFrame(result);
    expect(snapState.callbacks).toHaveLength(0);

    authState.firebaseUser = { uid: 'a' };
    await act(async () => {
      rerender();
    });
    const frame2 = captureFrame(result);
    expect(snapState.callbacks).toHaveLength(2);

    await act(async () => {
      fireScheduleSnap({ exists: () => false, data: () => undefined });
    });
    const frame3 = captureFrame(result);

    const oracle: Frame[] = [
      {
        loading: false,
        weekly: defaultWeekly,
        holidayMode: 'same',
        holidaySchedules: undefined,
        overrides: [],
      },
      // loading STAYS false — useState retained; no setLoading(true) in effect.
      {
        loading: false,
        weekly: defaultWeekly,
        holidayMode: 'same',
        holidaySchedules: undefined,
        overrides: [],
      },
      // Schedule snap empty → loading stays false (was already false),
      // weekly still default fallback.
      {
        loading: false,
        weekly: defaultWeekly,
        holidayMode: 'same',
        holidaySchedules: undefined,
        overrides: [],
      },
    ];

    const diff = diffFrames(
      [frame1, frame2, frame3],
      oracle,
      'L4 sign-in via rerender',
    );
    expect(diff.ok, diff.message).toBe(true);

    unmount();
  });
});
