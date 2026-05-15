/**
 * L1: useAppointments oracle-diff test.
 *
 * Gate 2 of the Phase -1 lint-cleanup verification sub-checklist (see
 * docs/agent-runs/agent-8-test-plan.md §3 row L1).
 *
 * Verifies that the post-cleanup useAppointments hook (commit 77eb960)
 * preserves documented behavior over a controlled input sequence. The
 * oracle is hand-coded as the expected (loading, pending, confirmed,
 * pastRecent, rejectedRecent) tuple per frame; diffFrames does a
 * canonical-JSON comparison and locates the first divergence.
 *
 * Post-cleanup pattern (read from apps/web/src/hooks/useAppointments.ts
 * after the merge of feature/sync-study-lint-cleanup at 8e1272f):
 *   - useState<boolean>(Boolean(uid)) — loading initialises from uid.
 *   - useEffect: `if (!uid) return;` — NO setLoading in the early
 *     return path; NO setLoading(true) anywhere in the effect body.
 *   - onSnapshot callback: setLoading(false) at the end.
 * Consequences for the oracle:
 *   - Cold mount with uid=undefined: loading=false from frame 1; no
 *     subscription created.
 *   - Cold mount with uid='a': loading=true initially, flips to false
 *     on the first snapshot fire.
 *   - Rerender uid undefined → 'a': loading STAYS false (useState
 *     retained across rerenders; no setLoading(true)) — no transient
 *     loading=true frame on sign-in via rerender.
 *   - Rerender uid 'a' → undefined: loading stays at its current value;
 *     pending/confirmed/etc arrays are NOT cleared.
 *
 * Owned by agent-8-tester. If any assertion fails, do NOT modify
 * production code — report to team-lead as a Gate 2 FAIL with the
 * diffFrames message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { diffFrames } from './_helpers/replayHook';

// --- vi.hoisted state for mocks ---------------------------------------------

const { authState, snapState } = vi.hoisted(() => ({
  authState: { firebaseUser: null as { uid: string } | null },
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

// Imported AFTER vi.mock declarations so the mocks take effect.
import { useAppointments } from '@/hooks/useAppointments';

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

type Frame = {
  loading: boolean;
  pending: unknown[];
  confirmed: unknown[];
  pastRecent: unknown[];
  rejectedRecent: unknown[];
};

function captureFrame(result: {
  current: ReturnType<typeof useAppointments>;
}): Frame {
  return {
    loading: result.current.loading,
    pending: result.current.pending,
    confirmed: result.current.confirmed,
    pastRecent: result.current.pastRecent,
    rejectedRecent: result.current.rejectedRecent,
  };
}

// System time fixed so PAST_VISIBILITY_DAYS=7 cutoff math is deterministic.
// 2026-05-15 12:00 UTC → cutoff = 2026-05-08 12:00 UTC.
const SYSTEM_NOW = new Date('2026-05-15T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(SYSTEM_NOW);
  authState.firebaseUser = null;
  snapState.cb = null;
  snapState.unsubCount = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// --- fixtures ---------------------------------------------------------------

// p1: pending → goes to pending list unconditionally.
const p1 = {
  appointmentId: 'p1',
  status: 'pending' as const,
  babysitterUserId: 'a',
  familyId: 'f1',
  date: '2026-06-01',
  startTime: '14:00',
  endTime: '17:00',
  updatedAt: makeTimestamp(new Date('2026-05-14T10:00:00Z')),
};

// c1: confirmed future → confirmed list.
const c1 = {
  appointmentId: 'c1',
  status: 'confirmed' as const,
  babysitterUserId: 'a',
  familyId: 'f1',
  date: '2026-06-01',
  startTime: '14:00',
  endTime: '17:00',
  updatedAt: makeTimestamp(new Date('2026-05-14T10:00:00Z')),
};

// c2: confirmed yesterday, endTime well past now in any TZ → pastRecent.
// aptDate=2026-05-14 ≥ cutoff=2026-05-08 → kept.
const c2 = {
  appointmentId: 'c2',
  status: 'confirmed' as const,
  babysitterUserId: 'a',
  familyId: 'f1',
  date: '2026-05-14',
  startTime: '08:00',
  endTime: '10:00',
  updatedAt: makeTimestamp(new Date('2026-05-13T10:00:00Z')),
};

// r1: rejected with updatedAt within cutoff → rejectedRecent.
const r1 = {
  appointmentId: 'r1',
  status: 'rejected' as const,
  babysitterUserId: 'a',
  familyId: 'f1',
  updatedAt: makeTimestamp(new Date('2026-05-14T10:00:00Z')),
};

// r2: rejected with resubmitted=true → must be filtered out by the
// hook's `if (apt.resubmitted) return` guard.
const r2 = {
  appointmentId: 'r2',
  status: 'rejected' as const,
  babysitterUserId: 'a',
  familyId: 'f1',
  updatedAt: makeTimestamp(new Date('2026-05-14T10:00:00Z')),
  resubmitted: true,
};

// --- tests ------------------------------------------------------------------

describe('L1: useAppointments — Gate 2 oracle-diff', () => {
  it('cold mount with uid=undefined: loading=false, no subscription created', async () => {
    const { result, unmount } = renderHook(() => useAppointments());
    await act(async () => {});

    const frames: Frame[] = [captureFrame(result)];
    const oracle: Frame[] = [
      {
        loading: false,
        pending: [],
        confirmed: [],
        pastRecent: [],
        rejectedRecent: [],
      },
    ];

    const diff = diffFrames(frames, oracle, 'L1 cold-mount-no-uid');
    expect(diff.ok, diff.message).toBe(true);
    expect(snapState.cb).toBeNull();
    expect(snapState.unsubCount).toBe(0);

    unmount();
  });

  it('cold mount with uid="a": loading=true initially, flips to false on first snap; partition + resubmitted filter', async () => {
    authState.firebaseUser = { uid: 'a' };
    const { result, unmount } = renderHook(() => useAppointments());
    await act(async () => {});

    const frames: Frame[] = [captureFrame(result)];

    await act(async () => {
      fireSnap([
        { id: 'p1', data: p1 },
        { id: 'c1', data: c1 },
        { id: 'c2', data: c2 },
        { id: 'r1', data: r1 },
        { id: 'r2', data: r2 }, // resubmitted → filtered
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
        pastRecent: [c2],
        rejectedRecent: [r1],
      },
    ];

    const diff = diffFrames(frames, oracle, 'L1 mount-with-uid + first snap');
    expect(diff.ok, diff.message).toBe(true);

    unmount();
  });

  it('second snap with subset updates the partition; r2 still filtered', async () => {
    authState.firebaseUser = { uid: 'a' };
    const { result, unmount } = renderHook(() => useAppointments());
    await act(async () => {});

    await act(async () => {
      fireSnap([
        { id: 'p1', data: p1 },
        { id: 'c1', data: c1 },
        { id: 'c2', data: c2 },
        { id: 'r1', data: r1 },
        { id: 'r2', data: r2 },
      ]);
    });
    const frame1 = captureFrame(result);

    // Second snap: p1 dropped, r2 still present (and still filtered).
    await act(async () => {
      fireSnap([
        { id: 'c1', data: c1 },
        { id: 'c2', data: c2 },
        { id: 'r1', data: r1 },
        { id: 'r2', data: r2 },
      ]);
    });
    const frame2 = captureFrame(result);

    const oracle: Frame[] = [
      {
        loading: false,
        pending: [p1],
        confirmed: [c1],
        pastRecent: [c2],
        rejectedRecent: [r1],
      },
      {
        loading: false,
        pending: [],
        confirmed: [c1],
        pastRecent: [c2],
        rejectedRecent: [r1],
      },
    ];

    const diff = diffFrames([frame1, frame2], oracle, 'L1 second snap');
    expect(diff.ok, diff.message).toBe(true);

    unmount();
  });

  it('sign-out (uid="a" → undefined): state retained, no array clearing, old subscription unsubbed', async () => {
    authState.firebaseUser = { uid: 'a' };
    const { result, rerender, unmount } = renderHook(() => useAppointments());
    await act(async () => {});

    await act(async () => {
      fireSnap([
        { id: 'p1', data: p1 },
        { id: 'c1', data: c1 },
      ]);
    });
    const frame1 = captureFrame(result);

    authState.firebaseUser = null;
    await act(async () => {
      rerender();
    });
    const frame2 = captureFrame(result);

    const oracle: Frame[] = [
      {
        loading: false,
        pending: [p1],
        confirmed: [c1],
        pastRecent: [],
        rejectedRecent: [],
      },
      {
        // State retained: arrays NOT cleared, loading unchanged. The
        // post-cleanup effect's early return does not call setLoading
        // or reset arrays. This is documented (pre-existing) behavior.
        loading: false,
        pending: [p1],
        confirmed: [c1],
        pastRecent: [],
        rejectedRecent: [],
      },
    ];

    const diff = diffFrames([frame1, frame2], oracle, 'L1 sign-out retains state');
    expect(diff.ok, diff.message).toBe(true);
    expect(snapState.unsubCount).toBe(1);

    unmount();
  });

  it('sign-in via rerender (uid undefined → "a"): loading STAYS false (no setLoading(true) in effect)', async () => {
    const { result, rerender, unmount } = renderHook(() => useAppointments());
    await act(async () => {});
    const frame1 = captureFrame(result);

    authState.firebaseUser = { uid: 'a' };
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
      {
        // loading STAYS false — useState retains state across the
        // rerender, and the effect body has no setLoading(true) call.
        // No transient loading=true frame on sign-in via rerender.
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
      'L1 sign-in via rerender',
    );
    expect(diff.ok, diff.message).toBe(true);

    unmount();
  });
});
