import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { useFlashTimer } from '@ejm/shared-ui';

/**
 * Pins the two lifecycle guarantees the raw-setTimeout flash idiom kept
 * getting wrong (issue #222; the AreaPage CI flake, PR #221):
 * re-scheduling clears the pending callback, and unmount clears whatever
 * is left, so no callback can outlive the component. Timer-count assertions
 * follow the Toast dismiss-timer pin in this directory.
 */
function Demo({ delayMs = 3000 }: { delayMs?: number }) {
  const [flash, setFlash] = useState(false);
  const flashAfter = useFlashTimer();
  return (
    <>
      <button
        onClick={() => {
          setFlash(true);
          flashAfter(() => setFlash(false), delayMs);
        }}
      >
        trigger
      </button>
      <span data-testid="flag">{flash ? 'on' : 'off'}</span>
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFlashTimer', () => {
  it('runs the callback after the delay, once', () => {
    render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }));
    expect(screen.getByTestId('flag')).toHaveTextContent('on');
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('flag')).toHaveTextContent('off');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-triggering inside the window replaces the pending callback instead of stacking it', () => {
    render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }));
    // One pending timer, not two: the first was cleared.
    expect(vi.getTimerCount()).toBe(1);
    // The old timer's moment (t=3000) passes without clearing the flash...
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId('flag')).toHaveTextContent('on');
    // ...which clears only when the SECOND window completes (t=2000+3000).
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId('flag')).toHaveTextContent('off');
  });

  it('clears the pending callback on unmount', () => {
    const { unmount } = render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still flashes under StrictMode double-invoked effects', () => {
    // StrictMode's setup -> cleanup -> setup on mount preserves refs, so a
    // mounted flag restored only in cleanup would be stuck false and every
    // schedule call would be silently dropped -- in dev only, which is why
    // CI could not see it (PR #223 review round 2). Must be a real
    // <StrictMode> render: mount/unmount/mount creates fresh refs and would
    // not catch it.
    render(
      <StrictMode>
        <Demo />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }));
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('flag')).toHaveTextContent('off');
  });

  it('ignores a schedule call made after unmount', () => {
    // The reachable shape: an async handler awaits, the user navigates away,
    // the handler resumes on the dead component and calls flashAfter. Arming
    // there would create a timer nothing owns -- the exact failure mode the
    // hook exists to close (PR #223 review).
    const { result, unmount } = renderHook(() => useFlashTimer());
    unmount();
    result.current(() => {}, 3000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
