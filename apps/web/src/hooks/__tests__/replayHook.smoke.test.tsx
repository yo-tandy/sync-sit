/**
 * Smoke test for the oracle-diff harness in _helpers/replayHook.ts.
 *
 * Purpose: prove the harness wires correctly through vitest + jsdom +
 * @testing-library/react renderHook, and that diffFrames actually
 * catches both value mismatches and length mismatches. NOT a product
 * test — the L1–L6 sub-checklist tests will land in sibling files
 * under apps/web/src/hooks/__tests__/ once the lint-cleanup SHA is
 * handed off.
 *
 * Owned by agent-8-tester. Do not extend with assertions about
 * production hooks here.
 */
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { diffFrames, replayHook } from './_helpers/replayHook';

// Trivial derivation hook: re-derives output from its arg on every
// render (no useState retention). Doubles the input number.
function useDouble(n: number): { value: number } {
  return { value: n * 2 };
}

// Trivial state-retention hook: seeds useState from initial arg and
// IGNORES subsequent arg changes. Used to verify the harness captures
// React's actual semantics (state is sticky across rerenders), not an
// idealized "props === state" model.
function useSeededOnce(initial: number): { value: number } {
  const [value] = useState(initial);
  return { value };
}

describe('replayHook + diffFrames smoke', () => {
  it('captures one output frame per input frame, in order', async () => {
    const out = await replayHook(useDouble, [1, 2, 3, 4]);
    expect(out).toEqual([
      { value: 2 },
      { value: 4 },
      { value: 6 },
      { value: 8 },
    ]);
  });

  it('preserves React semantics: useState seeded from first arg sticks across rerenders', async () => {
    const out = await replayHook(useSeededOnce, [10, 20, 30]);
    expect(out).toEqual([
      { value: 10 },
      { value: 10 },
      { value: 10 },
    ]);
  });

  it('returns ok=true when actual matches oracle frame-for-frame', async () => {
    const actual = await replayHook(useDouble, [1, 2, 3]);
    const oracle = await replayHook(useDouble, [1, 2, 3]);
    const diff = diffFrames(actual, oracle, 'useDouble');
    expect(diff.ok).toBe(true);
    expect(diff.firstDivergenceIndex).toBeNull();
    expect(diff.message).toBe('');
  });

  it('catches a value divergence at the correct frame index', () => {
    const actual = [{ value: 2 }, { value: 4 }, { value: 6 }, { value: 8 }];
    const oracle = [{ value: 2 }, { value: 4 }, { value: 6 }, { value: 9 }];
    const diff = diffFrames(actual, oracle, 'useDouble divergence');
    expect(diff.ok).toBe(false);
    expect(diff.firstDivergenceIndex).toBe(3);
    expect(diff.message).toContain('frame 3');
    expect(diff.message).toContain('actual:');
    expect(diff.message).toContain('oracle:');
  });

  it('catches a length mismatch', () => {
    const diff = diffFrames([1, 2, 3], [1, 2], 'length-mismatch');
    expect(diff.ok).toBe(false);
    expect(diff.firstDivergenceIndex).toBe(2);
    expect(diff.message).toContain('length mismatch');
  });

  it('treats object key insertion order as equivalent', () => {
    const actual = [{ a: 1, b: 2 } as Record<string, number>];
    const oracle = [{ b: 2, a: 1 } as Record<string, number>];
    const diff = diffFrames(actual, oracle, 'key-order');
    expect(diff.ok).toBe(true);
  });
});
