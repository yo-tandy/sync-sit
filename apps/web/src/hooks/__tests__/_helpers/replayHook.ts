/**
 * Oracle-diff replay harness for the Phase -1 lint-cleanup verification
 * sub-checklist (see docs/agent-runs/agent-8-test-plan.md §3 rows L1–L5).
 * The L1–L5 hook tests drive a pre-cleanup oracle and the post-cleanup
 * live hook through the same input sequence, then call diffFrames to
 * locate the first divergent frame; any divergence is a regression.
 *
 * Not a test file — vitest does not execute it (no .test.* suffix) and
 * tsconfig.app.json excludes it from the apps/web build.
 */
import { act, renderHook } from '@testing-library/react';

/**
 * Drive a hook through an ordered sequence of input frames and return
 * the per-frame output array.
 *
 * - The first frame is used as initialProps.
 * - Each subsequent frame triggers a rerender wrapped in act() so
 *   queued state updates, useEffect callbacks, and pending microtasks
 *   settle before the result is captured.
 * - Captured values are deep-cloned so later state mutations cannot
 *   retroactively alter earlier frames (testing-library returns
 *   `result.current` by reference).
 *
 * For hooks that depend on external state (e.g. useAuthStore), wrap
 * the hook in a small callback that applies the per-frame state
 * mutation before invoking the hook, then pass the wrapper to
 * replayHook. See the L1–L5 test files (when authored) for the
 * canonical pattern.
 */
export async function replayHook<TArgs, TResult>(
  hook: (args: TArgs) => TResult,
  sequence: readonly TArgs[],
): Promise<TResult[]> {
  if (sequence.length === 0) return [];
  const [first, ...rest] = sequence;
  const results: TResult[] = [];

  const { result, rerender } = renderHook(
    (args: TArgs) => hook(args),
    { initialProps: first },
  );
  // Flush mount-effects + microtasks before snapshotting frame 0.
  await act(async () => {});
  results.push(deepClone(result.current));

  for (const args of rest) {
    await act(async () => {
      rerender(args);
    });
    results.push(deepClone(result.current));
  }
  return results;
}

export interface DiffResult {
  ok: boolean;
  firstDivergenceIndex: number | null;
  message: string;
}

/**
 * Compare two frame arrays produced by replayHook. Returns ok=true on
 * exact match, otherwise the first divergent frame index plus a
 * single-line per-side JSON dump of the mismatch.
 *
 * Object keys are normalized (sorted) before stringification so that
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` compare equal — this matters
 * because the React hooks under test build their result tuples by
 * sequential setState calls, and key insertion order is not part of
 * the behavioral contract.
 */
export function diffFrames<T>(
  actual: readonly T[],
  oracle: readonly T[],
  label: string = 'frames',
): DiffResult {
  if (actual.length !== oracle.length) {
    return {
      ok: false,
      firstDivergenceIndex: Math.min(actual.length, oracle.length),
      message:
        `${label}: length mismatch — actual emitted ${actual.length} ` +
        `frame(s), oracle emitted ${oracle.length} frame(s).`,
    };
  }
  for (let i = 0; i < actual.length; i++) {
    const a = canonicalJson(actual[i]);
    const o = canonicalJson(oracle[i]);
    if (a !== o) {
      return {
        ok: false,
        firstDivergenceIndex: i,
        message:
          `${label}: divergence at frame ${i}\n` +
          `  actual: ${a}\n` +
          `  oracle: ${o}`,
      };
    }
  }
  return { ok: true, firstDivergenceIndex: null, message: '' };
}

// --- internals -------------------------------------------------------

function deepClone<T>(value: T): T {
  if (value === undefined) return undefined as T;
  return JSON.parse(JSON.stringify(value, replacer));
}

function canonicalJson<T>(value: T): string {
  const s = JSON.stringify(value, replacer);
  return s === undefined ? 'undefined' : s;
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'function') return '[Function]';
  if (value instanceof Date) {
    return { __type: 'Date', value: value.toISOString() };
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(record).sort()) {
      sorted[k] = record[k];
    }
    return sorted;
  }
  return value;
}
