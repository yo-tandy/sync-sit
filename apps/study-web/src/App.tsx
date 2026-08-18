import { useState, useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';
import { router } from './router';
import { ForcedSignOutWatcher } from '@/components/ui/ForcedSignOutWatcher';
import { PushPrompt } from '@/components/ui/PushPrompt';
import { setupForegroundMessages } from '@/lib/pushNotifications';

export default function App() {
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    // setupForegroundMessages resolves async: if the effect is cleaned up
    // first (StrictMode double-invoke), the late-resolving listener must be
    // detached immediately or it leaks. Same for the dismiss timer.
    let unsub: (() => void) | undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setupForegroundMessages((title, body) => {
      setToast({ title, body });
      clearTimeout(timer);
      timer = setTimeout(() => setToast(null), 5000);
    }).then((fn) => {
      if (cancelled) fn?.();
      else unsub = fn;
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsub?.();
    };
  }, []);

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
