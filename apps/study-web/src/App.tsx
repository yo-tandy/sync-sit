import { RouterProvider } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';
import { router } from './router';
import { ForcedSignOutWatcher } from '@/components/ui/ForcedSignOutWatcher';

export default function App() {
  return (
    <ToastProvider>
      <RouterProvider router={router} />
      <ForcedSignOutWatcher />
    </ToastProvider>
  );
}
