import { useState, useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { ToastProvider, useFlashTimer } from '@ejm/shared-ui';
import { router } from './router';
import { ForcedSignOutWatcher } from '@/components/ui/ForcedSignOutWatcher';
import { PushPrompt } from '@/components/ui/PushPrompt';
import { setupForegroundMessages } from '@/lib/pushNotifications';

/**
 * App root, scaffolded from study-web's — including its push plumbing
 * (plan §13 PR9): foreground FCM toasts, the PushPrompt soft prompt, and
 * the messaging service worker in public/.
 */
export default function App() {
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);

  // Dismiss-timer lifecycle (clear on re-toast, clear on unmount) lives in
  // the shared hook (issue #222); flashAfter is referentially stable.
  const flashAfter = useFlashTimer();

  useEffect(() => {
    // setupForegroundMessages resolves async: if the effect is cleaned up
    // first (StrictMode double-invoke), the late-resolving listener must be
    // detached immediately or it leaks.
    let unsub: (() => void) | undefined;
    let cancelled = false;
    setupForegroundMessages((title, body) => {
      setToast({ title, body });
      flashAfter(() => setToast(null), 5000);
    }).then((fn) => {
      if (cancelled) fn?.();
      else unsub = fn;
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [flashAfter]);

  return (
    <ToastProvider>
      <RouterProvider router={router} />
      <ForcedSignOutWatcher />
      <PushPrompt />
      {toast && (
        <div className="fixed top-4 left-4 right-4 z-50 mx-auto max-w-sm">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
            <p className="text-sm font-semibold text-gray-900">{toast.title}</p>
            <p className="text-xs text-gray-500">{toast.body}</p>
          </div>
        </div>
      )}
    </ToastProvider>
  );
}
