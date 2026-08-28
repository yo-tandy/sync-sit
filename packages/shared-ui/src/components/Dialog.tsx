import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Accessible name for the dialog. Passing it opts the dialog into full
   * modal semantics: role="dialog" + aria-modal, focus moved into the panel
   * on open and restored to the opener on close, Escape-to-close, and a Tab
   * trap that keeps keyboard focus inside the panel. Call sites without a
   * name keep the legacy plain-div behavior — shipping aria-modal on an
   * unnamed dialog is an axe aria-dialog-name failure, and Escape/focus
   * changes must not land untested on the ~70 existing call sites. Naming
   * those sites (and thereby upgrading them) is a tracked follow-up sweep.
   */
  ariaLabel?: string;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open, onClose, ariaLabel, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const modal = ariaLabel !== undefined;

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // aria-modal tells assistive tech to treat everything outside the dialog
  // as non-existent, so focus must move INTO the panel on open (the opener
  // button is in the now-hidden subtree) and return to the opener on close.
  useEffect(() => {
    if (!open || !modal) return;
    const previouslyFocused = document.activeElement;
    panelRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [open, modal]);

  // Escape closes; Tab cycles inside the panel (the keyboard half of the
  // aria-modal contract — without it, Tab walks into the subtree AT was just
  // told to ignore).
  useEffect(() => {
    if (!open || !modal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (active && !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, modal, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" />
      <div
        ref={panelRef}
        tabIndex={modal ? -1 : undefined}
        role={modal ? 'dialog' : undefined}
        aria-modal={modal || undefined}
        aria-label={ariaLabel}
        className="relative my-auto w-full max-w-sm rounded-xl bg-white p-6 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
