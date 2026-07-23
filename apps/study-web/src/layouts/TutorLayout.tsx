import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { Spinner } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';
import { ScrollToTop } from '@/components/ScrollToTop';

export function TutorLayout() {
  return (
    <AuthGuard role="tutor">
      <div className="min-h-screen bg-white">
        <ScrollToTop />
        <AppBar />
        <Suspense
          fallback={
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </div>
    </AuthGuard>
  );
}
