import { Outlet } from 'react-router';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';

export function AdminLayout() {
  return (
    <AuthGuard role="admin">
      <div className="min-h-screen bg-gray-50">
        <AppBar role="admin" />
        <Outlet />
      </div>
    </AuthGuard>
  );
}
