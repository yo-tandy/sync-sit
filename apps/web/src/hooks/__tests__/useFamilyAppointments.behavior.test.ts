/**
 * L3: useFamilyAppointments oracle-diff test.
 *
 * Gate 2 of the Phase -1 lint-cleanup verification sub-checklist (see
 * docs/agent-runs/agent-8-test-plan.md §3 row L3).
 *
 * Post-cleanup pattern (read from apps/web/src/hooks/useFamilyAppointments.ts
 * after merge 8e1272f):
 *   - Selector: useAuthStore((s) => s.userDoc); familyId derived as
 *     (userDoc as ParentUser | null)?.familyId.
 *   - useState<boolean>(Boolean(familyId)) — loading initialises from
 *     familyId.
 *   - useEffect deps on [familyId]: `if (!familyId) return;` — no
 *     setLoading anywhere in the effect body.
 *   - onSnapshot callback: setLoading(false) at the end. Same partition
 *     rules as useAppointments (pending / confirmed-future /
 *     confirmed-past-within-cutoff → pastRecent / rejected-or-cancelled
 *     within cutoff → rejectedRecent / resubmitted filtered).
 *
 * Same loading-transition consequences: sign-in via rerender does NOT
 * produce a transient loading=true frame.
 *
 * Owned by agent-8-tester. If any assertion fails, report to team-lead
 * as a Gate 2 FAIL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { diffFrames } from './_helpers/replayHook';

// --- vi.hoisted state for mocks ---------------------------------------------

type MockUserDoc = { role: 'parent'; familyId?: string };

const { authState, snapState } = vi.hoisted(() => ({
  authState: { userDoc: null as { role: 'parent'; familyId?: string } | null },
  snapState: {
    cb: null as
      | null
      | ((snap: { docs: Array<{ id: string; data: () => unknown }> }) => void),
    unsubCount: 0,
  },
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T>(selector: (s: typeof authState) => T) => selector(authState),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  query: (c: unknown, ...rest: unknown[]) => ({ __query: { c, rest } }),
  where: (field: string, op: string, val: unknown) => ({
    __where: { field, op, val },
  }),
  onSnapshot: (_q: unknown, cb: (snap: unknown) => void) => {
    snapState.cb = cb as typeof snapState.cb;
    return () => {
      snapState.unsubCount++;
    };
  },
}));

import { useFamilyAppointments } from '@/hooks/useFamilyAppointments';

// --- helpers ----------------------------------------------------------------

function makeTimestamp(d: Date) {
  return {
    toDate: () => d,
    seconds: Math.floor(d.getTime() / 1000),
    nanoseconds: 0,
  };
}

function fireSnap(docs: Array<{ id: string; data: unknown }>) {
  if (!snapState.cb) throw new Error('no snapshot callback registered');
  snapState.cb({
    docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
  });
}

function setUserDoc(d: MockUserDoc | null) {
  authState.userDoc = d;
}

type Frame = {
  loading: boolean;
  pending: unknown[];
  confirmed: unknown[];
  pastRecent: unknown[];
  rejectedRecent: unknown[];
};

function captureFrame(result: {
  current: ReturnType<typeof useFamilyAppointments>;
}): Frame {
  return {
    loading: result.current.loading,
    pending: result.current.pending,
    confirmed: result.current.confirmed,
    pastRecent: result.current.pastRecent,
    rejectedRecent: result.current.rejectedRecent,
  };
}

const SYSTEM_NOW = new Date('2026-05-15T12:00:00Z');
// cutoff = SYSTEM_NOW - 7 days = 2026-05-08T12:00:00Z

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(SYSTEM_NOW);
  authState.userDoc = null;
  snapState.cb = null;
  snapState.unsubCount = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// --- fixtures ---------------------------------------------------------------

const p1 = {
  appointmentId: 'p1',
  status: 'pending' as const,
  babysitterUserId: 'b1',
  familyId: 'f1',
  date: '2026-06-01',
  startTime: '14:00',
  endTime: '17:00',
  updatedAt: makeTimestamp(new Date('2026-05-14T10:00:00Z')),
};

const c1 = {
  appointmentId: 'c1',
  status: 'confirmed' as const,
  babysitterUserId: 'b1',
  familyId: 'f1',
  date: '2026-06-01',
  startTime: '14:00',
  endTime: '17:00',
  updatedAt: makeTimestamp(new Date('2026-05-14T10:00:00Z')),
};

// cancelled-old: updatedAt 2026-04-01 (more than 7 days before SYSTEM_NOW)
// → outside the rejectedRecent cutoff → silently dropped.
const cancelledOld = {
  appointmentId: 'cancOld',
  status: 'cancelled' as const,
  babysitterUserId: 'b1',
  familyId: 'f1',
  date: '2026-04-01',
  startTime: '14:00',
  endTime: '17:00',
  updatedAt: makeTimestamp(new Date('2026-04-01T10:00:00Z')),
};

// f2 doc (different family) — sanity for the family-switch scenario.
const f2c1 = {
  appointmentId: 'f2c1',
  status: 'confirmed' as const,
  babysitterUserId: 'b2',
  familyId: 'f2',
  date: '2026-07-01',
  startTime: '10:00',
  endTime: '12:00',
  updatedAt: makeTimestamp(new Date('2026-05-14T10:00:00Z')),
};

// --- tests ------------------------------------------------------------------

describe('L3: useFamilyAppointments — Gate 2 oracle-diff', () => {
  it('cold mount with userDoc=null: loading=false, no subscription', async () => {
    const { result, unmount } = renderHook(() => useFamilyAppointments());
    await act(async () => {});

    const oracle: Frame[] = [
      {
        loading: false,
        pending: [],
        confirmed: [],
        pastRecent: [],
        rejectedRecent: [],
      },
    ];
    const diff = diffFrames(
      [captureFrame(result)],
      oracle,
      'L3 cold-mount-no-userDoc',
    );
    expect(diff.ok, diff.message).toBe(true);
    expect(snapState.cb).toBeNull();

    unmount();
  });

  it('cold mount with userDoc that has no familyId: loading=false, no subscription', async () => {
    setUserDoc({ role: 'parent', familyId: undefined });
    const { result, unmount } = renderHook(() => useFamilyAppointments());
    await act(async () => {});

    const oracle: Frame[] = [
      {
        loading: false,
        pending: [],
        confirmed: [],
        pastRecent: [],
        rejectedRecent: [],
      },
    ];
    const diff = diffFrames(
      [captureFrame(result)],
      oracle,
      'L3 cold-mount-no-familyId',
    );
    expect(diff.ok, diff.message).toBe(true);
    expect(snapState.cb).toBeNull();

    unmount();
  });

  it('cold mount with familyId="f1": loading=true, snap partitions and drops outside-cutoff cancellations', async () => {
    setUserDoc({ role: 'parent', familyId: 'f1' });
    const { result, unmount } = renderHook(() => useFamilyAppointments());
    await act(async () => {});

    const frames: Frame[] = [captureFrame(result)];

    await act(async () => {
      fireSnap([
        { id: 'p1', data: p1 },
        { id: 'c1', data: c1 },
        { id: 'cancOld', data: cancelledOld }, // outside cutoff → dropped
      ]);
    });
    frames.push(captureFrame(result));

    const oracle: Frame[] = [
      {
        loading: true,
        pending: [],
        confirmed: [],
        pastRecent: [],
        rejectedRecent: [],
      },
      {
        loading: false,
        pending: [p1],
        confirmed: [c1],
        pastRecent: [],
        rejectedRecent: [], // cancelledOld outside cutoff → silently dropped
      },
    ];

    const diff = diffFrames(frames, oracle, 'L3 mount-with-familyId + first snap');
    expect(diff.ok, diff.message).toBe(true);

    unmount();
  });

  it('familyId change f1 → f2: state retained between switch and new snap; unsub fires', async () => {
    setUserDoc({ role: 'parent', familyId: 'f1' });
    const { result, rerender, unmount } = renderHook(() => useFamilyAppointments());
    await act(async () => {});

    await act(async () => {
      fireSnap([
        { id: 'p1', data: p1 },
        { id: 'c1', data: c1 },
      ]);
    });
    const frame1 = captureFrame(result);

    // Switch family. The effect cleanup runs (unsub f1), then re-runs
    // to subscribe to f2. State (useState) is retained, so loading
    // stays false and arrays still show f1 data until the f2 snap fires.
    setUserDoc({ role: 'parent', familyId: 'f2' });
    await act(async () => {
      rerender();
    });
    const frame2 = captureFrame(result);

    await act(async () => {
      fireSnap([{ id: 'f2c1', data: f2c1 }]);
    });
    const frame3 = captureFrame(result);

    const oracle: Frame[] = [
      {
        loading: false,
        pending: [p1],
        confirmed: [c1],
        pastRecent: [],
        rejectedRecent: [],
      },
      {
        // State retained from f1 snap; no setLoading(true) in effect
        // when familyId changes.
        loading: false,
        pending: [p1],
        confirmed: [c1],
        pastRecent: [],
        rejectedRecent: [],
      },
      {
        loading: false,
        pending: [],
        confirmed: [f2c1],
        pastRecent: [],
        rejectedRecent: [],
      },
    ];

    const diff = diffFrames([frame1, frame2, frame3], oracle, 'L3 family switch');
    expect(diff.ok, diff.message).toBe(true);
    expect(snapState.unsubCount).toBe(1);

    unmount();
  });

  it('sign-in via rerender (userDoc=null → with familyId): loading STAYS false', async () => {
    const { result, rerender, unmount } = renderHook(() => useFamilyAppointments());
    await act(async () => {});
    const frame1 = captureFrame(result);

    setUserDoc({ role: 'parent', familyId: 'f1' });
    await act(async () => {
      rerender();
    });
    const frame2 = captureFrame(result);

    await act(async () => {
      fireSnap([{ id: 'p1', data: p1 }]);
    });
    const frame3 = captureFrame(result);

    const oracle: Frame[] = [
      {
        loading: false,
        pending: [],
        confirmed: [],
        pastRecent: [],
        rejectedRecent: [],
      },
      // loading STAYS false — useState retained, no setLoading(true).
      {
        loading: false,
        pending: [],
        confirmed: [],
        pastRecent: [],
        rejectedRecent: [],
      },
      {
        loading: false,
        pending: [p1],
        confirmed: [],
        pastRecent: [],
        rejectedRecent: [],
      },
    ];

    const diff = diffFrames(
      [frame1, frame2, frame3],
      oracle,
      'L3 sign-in via rerender',
    );
    expect(diff.ok, diff.message).toBe(true);

    unmount();
  });
});
