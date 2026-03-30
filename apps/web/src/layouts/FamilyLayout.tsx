import { Outlet } from 'react-router';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';

export function FamilyLayout() {
  return (
    <AuthGuard role="parent">
      <div className="min-h-screen bg-white">
        <AppBar role="parent" />
        <Outlet />
      </div>
    </AuthGuard>
  );
}
