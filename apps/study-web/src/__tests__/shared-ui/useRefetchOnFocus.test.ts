import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRefetchOnFocus } from '@ejm/shared-ui';

// The refetch-on-focus hook (issue #117 tier a): a returning user gets fresh
// data (window focus OR the tab becoming visible), throttled so rapid
// alt-tabbing doesn't hammer Firestore/callables. Fake timers also fake
// Date.now, which the throttle window is measured with.

function focus() {
  window.dispatchEvent(new Event('focus'));
}

function visibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useRefetchOnFocus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore jsdom's default visibilityState for the next test.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('calls refetch once on window focus', () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnFocus(refetch));

    focus();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT call again for a second focus inside minIntervalMs', () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnFocus(refetch, { minIntervalMs: 15000 }));

    focus();
    vi.advanceTimersByTime(5000);
    focus();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('calls again once the interval has elapsed', () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnFocus(refetch, { minIntervalMs: 15000 }));

    focus();
    vi.advanceTimersByTime(15000);
    focus();
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('triggers on visibilitychange to visible, but not to hidden', () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnFocus(refetch));

    visibility('hidden');
    expect(refetch).not.toHaveBeenCalled();

    visibility('visible');
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire when focus and visibilitychange arrive together', () => {
    const refetch = vi.fn();
    renderHook(() => useRefetchOnFocus(refetch, { minIntervalMs: 15000 }));

    // Browsers fire both when the user returns to the tab — one refetch.
    visibility('visible');
    focus();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('removes listeners on unmount', () => {
    const refetch = vi.fn();
    const { unmount } = renderHook(() => useRefetchOnFocus(refetch));
    unmount();

    focus();
    visibility('visible');
    expect(refetch).not.toHaveBeenCalled();
  });

  it('uses the LATEST refetch closure after a rerender', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: () => void }) => useRefetchOnFocus(cb), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });
    focus();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
