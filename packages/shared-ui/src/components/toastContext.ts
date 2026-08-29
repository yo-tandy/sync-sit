import { createContext, useContext } from 'react';

/**
 * Context + consumer hook for the toast idiom. Kept in a component-free module
 * so `Toast.tsx` exports only `ToastProvider`: a file that mixes component and
 * non-component exports breaks React Fast Refresh for every component in it
 * (react-refresh/only-export-components).
 *
 * See `Toast.tsx` for when to use a toast at all.
 */

export type ToastTone = 'success' | 'error';

export type ToastFn = (message: string, options?: { tone?: ToastTone }) => void;

export const ToastContext = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const toast = useContext(ToastContext);
  if (!toast) {
    throw new Error('useToast must be used within a ToastProvider (mount it once at the app root)');
  }
  return toast;
}
