import { RouterProvider } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';
import { router } from './router';
import { ForcedSignOutWatcher } from '@/components/ui/ForcedSignOutWatcher';

/**
 * App root, scaffolded from study-web's. No push plumbing yet: foreground FCM
 * toasts, PushPrompt and the messaging service worker arrive with sync-do's
 * notifications PR (plan §13 PR9), not the shell.
 */
export default function App() {
  return (
    <ToastProvider>
      <RouterProvider router={router} />
      <ForcedSignOutWatcher />
    </ToastProvider>
  );
}
