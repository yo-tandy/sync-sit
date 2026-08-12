import { useEffect, useRef } from 'react';

export interface RefetchOnFocusOptions {
  /** Minimum ms between refetches — rapid alt-tabbing must not hammer Firestore/callables. */
  minIntervalMs?: number;
}

/**
 * Re-run a page's load function when the user returns to the tab (issue #117
 * tier a): window `focus` OR `visibilitychange` → visible, whichever fires.
 * Both paths share one throttle window, so the browser firing them together
 * (the common return-to-tab case) produces a single refetch.
 *
 * `refetch` is read through a ref, so pages can pass their existing load
 * functions without memoizing them.
 */
export function useRefetchOnFocus(
  refetch: () => void | Promise<unknown>,
  { minIntervalMs = 15000 }: RefetchOnFocusOptions = {},
): void {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const lastRunRef = useRef(0);

  useEffect(() => {
    const maybeRefetch = () => {
      const now = Date.now();
      if (now - lastRunRef.current < minIntervalMs) return;
      lastRunRef.current = now;
      void refetchRef.current();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') maybeRefetch();
    };
    window.addEventListener('focus', maybeRefetch);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', maybeRefetch);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [minIntervalMs]);
}
