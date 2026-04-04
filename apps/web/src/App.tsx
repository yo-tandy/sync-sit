import { useState, useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { router } from './router';
import { PushPrompt } from '@/components/ui/PushPrompt';
import { setupForegroundMessages } from '@/lib/pushNotifications';

export default function App() {
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    setupForegroundMessages((title, body) => {
      setToast({ title, body });
      setTimeout(() => setToast(null), 5000);
    }).then((fn) => { unsub = fn; });
    return () => { unsub?.(); };
  }, []);

  return (
    <>
      <RouterProvider router={router} />
      <PushPrompt />
      {toast && (
        <div className="fixed top-4 left-4 right-4 z-50 mx-auto max-w-sm">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
            <p className="text-sm font-semibold text-gray-900">{toast.title}</p>
            <p className="text-xs text-gray-500">{toast.body}</p>
          </div>
        </div>
      )}
    </>
  );
}
