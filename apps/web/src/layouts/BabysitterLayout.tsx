import { Outlet } from 'react-router';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';

export function BabysitterLayout() {
  return (
    <AuthGuard role="babysitter">
      <div className="min-h-screen bg-white">
        <AppBar role="babysitter" />
        <Outlet />
      </div>
    </AuthGuard>
  );
}
