import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { PageContainer, Spinner } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { DoerAppBar } from '@/components/ui/DoerAppBar';
import { AppSwitchBarHost } from '@/components/ui/AppSwitchBarHost';

/**
 * Doer portal shell (plan §13 PR8) — FamilyLayout's shape: guard on
 * role="doer" (admins pass through, see AuthGuard), the portal's own app
 * bar, and the desktop width cap around a Suspense'd Outlet. Replaces the
 * PR2 placeholder HomeLayout. The portal INDEX /doer is the dashboard (§9.0,
 * issue #360); the board it links to lives at /doer/board (§9.2).
 */
export function DoerLayout() {
  return (
    <AuthGuard role="doer">
      {/* pb-16 clears the fixed app-switch bar on phones; the bar is
          md:hidden so the padding lifts at the same breakpoint. */}
      <div className="min-h-screen bg-white pb-16 md:pb-0">
        <DoerAppBar />
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
        <AppSwitchBarHost />
      </div>
    </AuthGuard>
  );
}
