import { useCallback, useEffect, useRef } from 'react';

/**
 * A self-managing timeout for transient UI ("saved" flashes, copied
 * confirmations, toasts): schedule a callback to clear the state later,
 * without owning a timer's lifecycle by hand (issue #222).
 *
 * Two guarantees the raw setTimeout idiom kept getting wrong:
 * - scheduling again CLEARS the pending callback first, so re-triggering
 *   inside the window can't orphan a timer or clip the fresh flash short;
 * - unmount clears whatever is pending, so no callback ever fires into an
 *   unmounted component -- in tests that stray callback lands after jsdom
 *   teardown and fails a fully-green CI run with "window is not defined"
 *   (the AreaPage flake, PR #221).
 *
 * The returned function is stable (useCallback with no deps), so it can sit
 * in effect dependency arrays or be closed over by long-lived callbacks --
 * the App.tsx toast handlers do exactly that. Calls after unmount are
 * ignored: an async handler that resumes on a dead component (await, then
 * flash) must not arm a timer nothing owns any more.
 *
 * Each instance owns exactly ONE timer slot -- scheduling again replaces the
 * pending callback. A component with two independent flashes needs two
 * useFlashTimer() calls; sharing one would silently cancel the first flash
 * when the second fires.
 */
export function useFlashTimer(): (fn: () => void, delayMs: number) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    // StrictMode runs setup -> cleanup -> setup on mount and PRESERVES refs
    // across that simulated remount, so the flag must be restored in the
    // body -- a cleanup-only ref stays false forever on the second setup and
    // silently disables every flash in dev (PR #223 review round 2).
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return useCallback((fn: () => void, delayMs: number) => {
    if (timer.current) clearTimeout(timer.current);
    if (!mounted.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      fn();
    }, delayMs);
  }, []);
}
