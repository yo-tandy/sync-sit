/**
 * L5: useSubmittedEndorsements oracle-diff test.
 *
 * Gate 2 of the Phase -1 lint-cleanup verification sub-checklist (see
 * docs/agent-runs/agent-8-test-plan.md §3 row L5).
 *
 * Post-cleanup pattern (read from apps/web/src/hooks/useSubmittedEndorsements.ts
 * after merge 8e1272f):
 *   - useState<boolean>(Boolean(uid)) — loading initialises from uid.
 *   - useEffect: `if (!uid) return;` — no setLoading anywhere in the
 *     effect body.
 *   - onSnapshot callback: builds refs as `{ ...d.data(), referenceId:
 *     d.id }`, filters out status='removed', setReferences(refs),
 *     setLoading(false).
 *
 * Same loading-transition consequences as L1–L4: sign-in via rerender
 * does NOT produce a transient loading=true frame.
 *
 * Owned by agent-8-tester. Do not modify production code on failure.
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

import { useSubmittedEndorsements } from '@/hooks/useSubmittedEndorsements';

// --- helpers ----------------------------------------------------------------

function fireSnap(docs: Array<{ id: string; data: unknown }>) {
  if (!snapState.cb) throw new Error('no snapshot callback registered');
  snapState.cb({
    docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
  });
}

type Frame = {
  loading: boolean;
  references: unknown[];
};

function captureFrame(result: {
  current: ReturnType<typeof useSubmittedEndorsements>;
}): Frame {
  return {
    loading: result.current.loading,
    references: result.current.references,
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
// The hook stores each ref as { ...d.data(), referenceId: d.id }.

const r1Data = {
  babysitterUserId: 'b1',
  type: 'family_submitted' as const,
  status: 'private' as const,
  submittedByUserId: 'a',
};
const r1 = { ...r1Data, referenceId: 'r1' };

const r2Data = {
  babysitterUserId: 'b2',
  type: 'family_submitted' as const,
  status: 'removed' as const,
  submittedByUserId: 'a',
};
// r2 is removed → filtered out.

const r3Data = {
  babysitterUserId: 'b3',
  type: 'family_submitted' as const,
  status: 'published' as const,
  submittedByUserId: 'a',
};
const r3 = { ...r3Data, referenceId: 'r3' };

const r4Data = {
  babysitterUserId: 'b4',
  type: 'family_submitted' as const,
  status: 'private' as const,
  submittedByUserId: 'a',
};
const r4 = { ...r4Data, referenceId: 'r4' };

const r5Data = {
  babysitterUserId: 'b5',
  type: 'family_submitted' as const,
  status: 'published' as const,
  submittedByUserId: 'a',
};
const r5 = { ...r5Data, referenceId: 'r5' };

// --- tests ------------------------------------------------------------------

describe('L5: useSubmittedEndorsements — Gate 2 oracle-diff', () => {
  it('cold mount with uid=undefined: loading=false, no subscription', async () => {
    const { result, unmount } = renderHook(() => useSubmittedEndorsements());
    await act(async () => {});

    const oracle: Frame[] = [{ loading: false, references: [] }];
    const diff = diffFrames(
      [captureFrame(result)],
      oracle,
      'L5 cold-mount-no-uid',
    );
    expect(diff.ok, diff.message).toBe(true);
    expect(snapState.cb).toBeNull();

    unmount();
  });

  it('cold mount with uid="a": loading=true, snap filters status=removed', async () => {
    authState.firebaseUser = { uid: 'a' };
    const { result, unmount } = renderHook(() => useSubmittedEndorsements());
    await act(async () => {});

    const frames: Frame[] = [captureFrame(result)];

    await act(async () => {
      fireSnap([
        { id: 'r1', data: r1Data },
        { id: 'r2', data: r2Data }, // removed → filtered
        { id: 'r3', data: r3Data },
      ]);
    });
    frames.push(captureFrame(result));

    const oracle: Frame[] = [
      { loading: true, references: [] },
      { loading: false, references: [r1, r3] },
    ];

    const diff = diffFrames(frames, oracle, 'L5 mount-with-uid + first snap');
    expect(diff.ok, diff.message).toBe(true);

    unmount();
  });

  it('subsequent snap replaces the set; removed still filtered', async () => {
    authState.firebaseUser = { uid: 'a' };
    const { result, unmount } = renderHook(() => useSubmittedEndorsements());
    await act(async () => {});

    await act(async () => {
      fireSnap([
        { id: 'r1', data: r1Data },
        { id: 'r3', data: r3Data },
      ]);
    });
    const frame1 = captureFrame(result);

    await act(async () => {
      fireSnap([
        { id: 'r4', data: r4Data },
        { id: 'r5', data: r5Data },
        { id: 'r2', data: r2Data }, // still removed
      ]);
    });
    const frame2 = captureFrame(result);

    const oracle: Frame[] = [
      { loading: false, references: [r1, r3] },
      { loading: false, references: [r4, r5] },
    ];

    const diff = diffFrames([frame1, frame2], oracle, 'L5 second snap');
    expect(diff.ok, diff.message).toBe(true);

    unmount();
  });

  it('sign-out (uid="a" → undefined): state retained, unsub fires once', async () => {
    authState.firebaseUser = { uid: 'a' };
    const { result, rerender, unmount } = renderHook(() => useSubmittedEndorsements());
    await act(async () => {});

    await act(async () => {
      fireSnap([
        { id: 'r1', data: r1Data },
        { id: 'r3', data: r3Data },
      ]);
    });
    const frame1 = captureFrame(result);

    authState.firebaseUser = null;
    await act(async () => {
      rerender();
    });
    const frame2 = captureFrame(result);

    const oracle: Frame[] = [
      { loading: false, references: [r1, r3] },
      // State retained.
      { loading: false, references: [r1, r3] },
    ];

    const diff = diffFrames([frame1, frame2], oracle, 'L5 sign-out retains state');
    expect(diff.ok, diff.message).toBe(true);
    expect(snapState.unsubCount).toBe(1);

    unmount();
  });

  it('sign-in via rerender (uid undefined → "a"): loading STAYS false', async () => {
    const { result, rerender, unmount } = renderHook(() => useSubmittedEndorsements());
    await act(async () => {});
    const frame1 = captureFrame(result);

    authState.firebaseUser = { uid: 'a' };
    await act(async () => {
      rerender();
    });
    const frame2 = captureFrame(result);

    await act(async () => {
      fireSnap([{ id: 'r1', data: r1Data }]);
    });
    const frame3 = captureFrame(result);

    const oracle: Frame[] = [
      { loading: false, references: [] },
      // loading STAYS false on sign-in via rerender.
      { loading: false, references: [] },
      { loading: false, references: [r1] },
    ];

    const diff = diffFrames(
      [frame1, frame2, frame3],
      oracle,
      'L5 sign-in via rerender',
    );
    expect(diff.ok, diff.message).toBe(true);

    unmount();
  });
});
