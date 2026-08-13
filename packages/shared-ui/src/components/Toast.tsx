import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Toast — THE feedback idiom for transient confirmations (UX F7, issue #121).
 *
 * The rule:
 * - Use a toast to confirm an in-page mutation (save / accept / decline /
 *   add / remove). Fire it AFTER the callable or refetch resolves — never
 *   optimistically.
 * - Full-screen confirmation states are reserved for flow-ending moments
 *   (invite sent, enrollment complete) — do not convert those to toasts.
 * - Errors tied to a specific field stay inline next to that field, and
 *   load errors stay page states: anything the user must be able to read
 *   until acted on must not auto-dismiss.
 *
 * Behavior: bottom-center pill, one toast at a time (a new toast replaces
 * the current one and restarts the clock), auto-dismisses after ~3s,
 * non-interactive. `role="status"` for the success tone, `role="alert"`
 * for the error tone. Appearance is a plain swap (no slide/fade), so
 * reduced-motion needs no special casing.
 */

type ToastTone = 'success' | 'error';

type ToastFn = (message: string, options?: { tone?: ToastTone }) => void;

interface ToastState {
  message: string;
  tone: ToastTone;
  key: number;
}

const TOAST_DURATION_MS = 3000;

const ToastContext = createContext<ToastFn | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(0);

  const toast = useCallback<ToastFn>((message, options) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    keyRef.current += 1;
    setCurrent({ message, tone: options?.tone ?? 'success', key: keyRef.current });
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setCurrent(null);
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Both live regions stay MOUNTED and empty — screen readers only
          announce content CHANGES inside an existing live region; a region
          inserted together with its content is often not announced at all.
          The message span is keyed per toast: a REPEAT of the identical
          message would otherwise be a no-op DOM write (React skips it) and
          never re-announce; remounting the span inserts a fresh node, which
          live regions treat as an addition. */}
      <div
        role="status"
        className={
          current && current.tone !== 'error'
            ? 'pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg'
            : 'sr-only'
        }
      >
        {current && current.tone !== 'error' && <span key={current.key}>{current.message}</span>}
      </div>
      <div
        role="alert"
        className={
          current && current.tone === 'error'
            ? 'pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-error-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg'
            : 'sr-only'
        }
      >
        {current && current.tone === 'error' && <span key={current.key}>{current.message}</span>}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const toast = useContext(ToastContext);
  if (!toast) {
    throw new Error('useToast must be used within a ToastProvider (mount it once at the app root)');
  }
  return toast;
}
