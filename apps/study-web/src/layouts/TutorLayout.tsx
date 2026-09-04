import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { PageContainer, Spinner, useDocumentGround } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { AppBar } from '@/components/ui/AppBar';
import { AppSwitchBarHost } from '@/components/ui/AppSwitchBarHost';
import { ScrollToTop } from '@/components/ScrollToTop';

export function TutorLayout() {
  // Ground reaches html too (#424): iOS overscroll + the AuthGuard resolve
  // state paint the canvas, which no descendant div can tint.
  useDocumentGround('app');
  return (
    <AuthGuard role="tutor">
      {/* pb-16 clears the fixed app-switch bar on phones; the bar is
          md:hidden so the padding lifts at the same breakpoint. */}
      <div className="min-h-screen bg-ground pb-16 md:pb-0">
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
