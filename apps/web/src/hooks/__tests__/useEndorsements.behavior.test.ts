/**
 * L2: useEndorsements oracle-diff test.
 *
 * Gate 2 of the Phase -1 lint-cleanup verification sub-checklist (see
 * docs/agent-runs/agent-8-test-plan.md §3 row L2).
 *
 * Post-cleanup pattern (read from apps/web/src/hooks/useEndorsements.ts
 * after merge 8e1272f):
 *   - useState<boolean>(Boolean(uid)) — loading initialises from uid.
 *   - useEffect: `if (!uid) return;` — NO setLoading anywhere in the
 *     effect body.
 *   - onSnapshot callback: setManualRefs + setFamilySubmittedRefs +
 *     setLoading(false). The snapshot data is stored as
 *     `{ ...d.data(), referenceId: d.id }` (spread + overwrite id).
 *     Docs with status='removed' are filtered out.
 *
 * Same loading-transition consequences as L1 — sign-in via rerender
 * does NOT produce a transient loading=true frame.
 *
 * In addition to the loading + partition assertions, L2 verifies
 * callback-identity stability: the mutation callbacks (addManualReference,
 * updateManualReference, removeReference) are memoized via useCallback.
 * Their reference identity must be stable across rerenders where uid is
 * unchanged.
 *
 * Owned by agent-8-tester. If any assertion fails, do NOT modify
 * production code — report to team-lead as a Gate 2 FAIL.
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

// firebase/firestore mock — includes addDoc/updateDoc/doc/serverTimestamp
// because useEndorsements references these inside its useCallback closures.
// They are not invoked in this test, but the imports must resolve.
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  query: (c: unknown, ...rest: unknown[]) => ({ __query: { c, rest } }),
  where: (field: string, op: string, val: unknown) => ({
    __where: { field, op, val },
  }),
  doc: (_db: unknown, ...path: string[]) => ({ __doc: path }),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: () => ({ __serverTimestamp: true }),
  onSnapshot: (_q: unknown, cb: (snap: unknown) => void) => {
    snapState.cb = cb as typeof snapState.cb;
    return () => {
      snapState.unsubCount++;
    };
  },
}));

import { useEndorsements } from '@/hooks/useEndorsements';

// --- helpers ----------------------------------------------------------------

function fireSnap(docs: Array<{ id: string; data: unknown }>) {
  if (!snapState.cb) throw new Error('no snapshot callback registered');
  snapState.cb({
    docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
  });
}

type Frame = {
  loading: boolean;
  manualRefs: unknown[];
  familySubmittedRefs: unknown[];
};

function captureFrame(result: {
  current: ReturnType<typeof useEndorsements>;
}): Frame {
  return {
    loading: result.current.loading,
    manualRefs: result.current.manualRefs,
    familySubmittedRefs: result.current.familySubmittedRefs,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  authState.firebaseUser = null;
  snapState.cb = null;
  snapState.unsubCount = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// --- fixtures ---------------------------------------------------------------
// Note: the hook stores refs as { ...d.data(), referenceId: d.id }. So the
// oracle includes referenceId on each ref, equal to the doc id we pass to
// fireSnap.

const m1Data = {
  babysitterUserId: 'a',
  type: 'manual' as const,
  status: 'private' as const,
  refName: 'Alice',
};
const m1 = { ...m1Data, referenceId: 'm1' };

const m2Data = {
  babysitterUserId: 'a',
  type: 'manual' as const,
  status: 'published' as const,
  refName: 'Bob',
};
const m2 = { ...m2Data, referenceId: 'm2' };

const f1Data = {
  babysitterUserId: 'a',
  type: 'family_submitted' as const,
  status: 'private' as const,
  submittedByUserId: 'parent-1',
  submittedByName: 'Family One',
};
const f1 = { ...f1Data, referenceId: 'f1' };

// rRemoved: removed → must be filtered out by `if (ref.status === 'removed') return`.
const rRemovedData = {
  babysitterUserId: 'a',
  type: 'manual' as const,
  status: 'removed' as const,
  refName: 'Removed One',
};

// --- tests ------------------------------------------------------------------

describe('L2: useEndorsements — Gate 2 oracle-diff', () => {
  it('cold mount with uid=undefined: loading=false, no subscription', async () => {
    const { result, unmount } = renderHook(() => useEndorsements());
    await act(async () => {});

    const oracle: Frame[] = [
      { loading: false, manualRefs: [], familySubmittedRefs: [] },
    ];
    const diff = diffFrames(
      [captureFrame(result)],
      oracle,
      'L2 cold-mount-no-uid',
    );
    expect(diff.ok, diff.message).toBe(true);
    expect(snapState.cb).toBeNull();

    unmount();
  });

  it('cold mount with uid="a": loading=true, snap partitions refs and filters removed', async () => {
    authState.firebaseUser = { uid: 'a' };
    const { result, unmount } = renderHook(() => useEndorsements());
    await act(async () => {});

    const frames: Frame[] = [captureFrame(result)];

    await act(async () => {
      fireSnap([
        { id: 'm1', data: m1Data },
        { id: 'm2', data: m2Data },
        { id: 'f1', data: f1Data },
        { id: 'rRemoved', data: rRemovedData },
      ]);
    });
    frames.push(captureFrame(result));

    const oracle: Frame[] = [
      { loading: true, manualRefs: [], familySubmittedRefs: [] },
      { loading: false, manualRefs: [m1, m2], familySubmittedRefs: [f1] },
    ];

    const diff = diffFrames(frames, oracle, 'L2 mount-with-uid + first snap');
    expect(diff.ok, diff.message).toBe(true);

    unmount();
  });

  it('mutation callbacks are memoized on uid: identity stable across rerenders with same uid', async () => {
    authState.firebaseUser = { uid: 'a' };
    const { result, rerender, unmount } = renderHook(() => useEndorsements());
    await act(async () => {});

    // Capture callback identities at frame 1.
    const before = {
      addManualReference: result.current.addManualReference,
      updateManualReference: result.current.updateManualReference,
      removeReference: result.current.removeReference,
    };

    // Trigger a snap (state changes → rerender), then a no-op rerender.
    await act(async () => {
      fireSnap([{ id: 'm1', data: m1Data }]);
    });
    await act(async () => {
      rerender();
    });

    const after = {
      addManualReference: result.current.addManualReference,
      updateManualReference: result.current.updateManualReference,
      removeReference: result.current.removeReference,
    };

    expect(Object.is(before.addManualReference, after.addManualReference)).toBe(true);
    expect(Object.is(before.updateManualReference, after.updateManualReference)).toBe(true);
    expect(Object.is(before.removeReference, after.removeReference)).toBe(true);

    unmount();
  });

  it('sign-out (uid="a" → undefined): state retained, no clearing, unsub fires once', async () => {
    authState.firebaseUser = { uid: 'a' };
    const { result, rerender, unmount } = renderHook(() => useEndorsements());
    await act(async () => {});

    await act(async () => {
      fireSnap([
        { id: 'm1', data: m1Data },
        { id: 'f1', data: f1Data },
      ]);
    });
    const frame1 = captureFrame(result);

    authState.firebaseUser = null;
    await act(async () => {
      rerender();
    });
    const frame2 = captureFrame(result);

    const oracle: Frame[] = [
      { loading: false, manualRefs: [m1], familySubmittedRefs: [f1] },
      { loading: false, manualRefs: [m1], familySubmittedRefs: [f1] },
    ];

    const diff = diffFrames([frame1, frame2], oracle, 'L2 sign-out retains state');
    expect(diff.ok, diff.message).toBe(true);
    expect(snapState.unsubCount).toBe(1);

    unmount();
  });

  it('sign-in via rerender (uid undefined → "a"): loading STAYS false (no setLoading(true) in effect)', async () => {
    const { result, rerender, unmount } = renderHook(() => useEndorsements());
    await act(async () => {});
    const frame1 = captureFrame(result);

    authState.firebaseUser = { uid: 'a' };
    await act(async () => {
      rerender();
    });
    const frame2 = captureFrame(result);

    await act(async () => {
      fireSnap([{ id: 'm1', data: m1Data }]);
    });
    const frame3 = captureFrame(result);

    const oracle: Frame[] = [
      { loading: false, manualRefs: [], familySubmittedRefs: [] },
      // loading STAYS false on sign-in via rerender.
      { loading: false, manualRefs: [], familySubmittedRefs: [] },
      { loading: false, manualRefs: [m1], familySubmittedRefs: [] },
    ];

    const diff = diffFrames(
      [frame1, frame2, frame3],
      oracle,
      'L2 sign-in via rerender',
    );
    expect(diff.ok, diff.message).toBe(true);

    unmount();
  });
});
