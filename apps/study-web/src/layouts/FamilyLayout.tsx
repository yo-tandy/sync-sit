import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { PageContainer, Spinner } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { FamilyAppBar } from '@/components/ui/FamilyAppBar';
import { AppSwitchBarHost } from '@/components/ui/AppSwitchBarHost';
import { ScrollToTop } from '@/components/ScrollToTop';

/**
 * Family portal shell. Mirrors TutorLayout, guarded on role="parent" with its
 * own FamilyAppBar (chrome is intentionally duplicated per portal).
 */
export function FamilyLayout() {
  return (
    <AuthGuard role="parent">
      {/* pb-16 clears the fixed app-switch bar on phones; the bar is
          md:hidden so the padding lifts at the same breakpoint. */}
      <div className="min-h-screen bg-white pb-16 md:pb-0">
        <ScrollToTop />
        <FamilyAppBar />
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
        <AppSwitchBarHost accountHref="/family/account" />
      </div>
    </AuthGuard>
  );
}
