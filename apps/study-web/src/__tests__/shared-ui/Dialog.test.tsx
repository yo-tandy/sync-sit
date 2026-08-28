import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from '@ejm/shared-ui';

/**
 * The Dialog primitive's modal semantics (issue #119 review): everything —
 * role/aria-modal, focus-in on open, focus-restore on close, Escape, Tab
 * trap — is opt-in via ariaLabel, so the ~70 unnamed call sites across both
 * apps keep their pre-#119 behavior byte-for-byte until the naming sweep
 * upgrades them.
 */
describe('Dialog (shared-ui)', () => {
  it('with ariaLabel: names the dialog, sets aria-modal, and moves focus into the panel', () => {
    render(
      <Dialog open onClose={() => {}} ariaLabel="Menu">
        <button>inside</button>
      </Dialog>,
    );
    const panel = screen.getByRole('dialog', { name: 'Menu' });
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(panel);
  });

  it('with ariaLabel: Escape calls onClose', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} ariaLabel="Menu">
        <p>content</p>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('with ariaLabel: returns focus to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(
      <Dialog open onClose={() => {}} ariaLabel="Menu">
        <p>content</p>
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    rerender(
      <Dialog open={false} onClose={() => {}} ariaLabel="Menu">
        <p>content</p>
      </Dialog>,
    );
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('with ariaLabel: Tab cycles inside the panel instead of escaping it', () => {
    render(
      <Dialog open onClose={() => {}} ariaLabel="Menu">
        <button>first</button>
        <button>last</button>
      </Dialog>,
    );
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'last' });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('without ariaLabel: keeps the legacy plain-div behavior (no role, no focus steal, no Escape)', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <p>legacy content</p>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('legacy content').parentElement).not.toHaveAttribute('aria-modal');
    expect(document.activeElement).toBe(opener);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    opener.remove();
  });

  it('backdrop click still closes; clicks inside the panel do not', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} ariaLabel="Menu">
        <p>content</p>
      </Dialog>,
    );
    fireEvent.click(screen.getByText('content'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
