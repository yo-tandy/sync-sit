import { Outlet } from 'react-router';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';
import { ScrollToTop } from '@/components/ScrollToTop';

export function TutorLayout() {
  return (
    <AuthGuard role="tutor">
      <div className="min-h-screen bg-white">
        <ScrollToTop />
        <AppBar />
        <Outlet />
      </div>
    </AuthGuard>
  );
}
