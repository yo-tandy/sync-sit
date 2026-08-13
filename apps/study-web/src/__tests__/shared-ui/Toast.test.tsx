import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '@ejm/shared-ui';

// Exercises the toast imperatively the way pages do: call toast() after a
// mutation resolves. Buttons stand in for the resolved-callable moment.
function Demo() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast('Saved')}>save</button>
      <button onClick={() => toast('Removed')}>remove</button>
      <button onClick={() => toast('Could not save', { tone: 'error' })}>fail</button>
    </>
  );
}

function renderDemo() {
  return render(
    <ToastProvider>
      <Demo />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast (shared-ui)', () => {
  it('mounts both live regions empty before any toast fires', () => {
    // Screen readers only announce content changes inside an ALREADY-mounted
    // live region — a region inserted together with its message is often
    // silent. Both regions must exist (empty) from provider mount.
    renderDemo();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('renders a success toast with role=status', () => {
    renderDemo();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Saved');
  });

  it('auto-dismisses after 3 seconds', () => {
    renderDemo();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('a new toast replaces the current one and resets the dismiss timer', () => {
    renderDemo();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'remove' }));
    // One toast at a time: the first message is gone, only the new one shows.
    const toasts = screen.getAllByRole('status');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toHaveTextContent('Removed');
    // Timer restarted: 2.9s after replacement (4.9s after first) still visible.
    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Removed');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('error tone renders role=alert instead of role=status', () => {
    renderDemo();
    fireEvent.click(screen.getByRole('button', { name: 'fail' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
  });

  it('clears the pending dismiss timer on unmount', () => {
    const { unmount } = renderDemo();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('useToast outside a ToastProvider throws a clear error', () => {
    // Silence React's error boundary logging for the intentional throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Demo />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
