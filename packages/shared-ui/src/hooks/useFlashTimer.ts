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
 * the App.tsx toast handlers do exactly that.
 */
export function useFlashTimer(): (fn: () => void, delayMs: number) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback((fn: () => void, delayMs: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      fn();
    }, delayMs);
  }, []);
}
