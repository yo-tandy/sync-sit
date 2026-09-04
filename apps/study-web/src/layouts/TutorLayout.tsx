import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { PageContainer, Spinner } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';
import { AppSwitchBarHost } from '@/components/ui/AppSwitchBarHost';
import { ScrollToTop } from '@/components/ScrollToTop';

export function TutorLayout() {
  return (
    <AuthGuard role="tutor">
      {/* pb-app-switch-bar reserves the fixed app-switch bar's height — the
          shared token (base.css, #419), row + safe-area inset. The bar is
          md:hidden so the padding lifts at the same breakpoint. */}
      <div className="min-h-screen bg-ground pb-app-switch-bar md:pb-0">
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
        <AppSwitchBarHost accountHref="/tutor/account" homeHref="/tutor" />
      </div>
    </AuthGuard>
  );
}
