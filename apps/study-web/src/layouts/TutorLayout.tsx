import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { PageContainer, Spinner } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';
import { ScrollToTop } from '@/components/ScrollToTop';

export function TutorLayout() {
  return (
    <AuthGuard role="tutor">
      <div className="min-h-screen bg-white">
        <ScrollToTop />
        <AppBar />
        {/* Desktop width cap (issue #119); wide pages opt out via data-page-width. */}
        <PageContainer>
          <Suspense
            fallback={
              <div className="flex justify-center py-20">
                <Spinner />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </PageContainer>
      </div>
    </AuthGuard>
  );
}
