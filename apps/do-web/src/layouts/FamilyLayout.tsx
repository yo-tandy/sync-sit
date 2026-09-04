import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { PageContainer, Spinner, useDocumentGround } from '@ejm/shared-ui';
import { AuthGuard } from './AuthGuard';
import { FamilyAppBar } from '@/components/ui/FamilyAppBar';
import { AppSwitchBarHost } from '@/components/ui/AppSwitchBarHost';

/**
 * Family portal shell (plan §13 PR7) — study-web's FamilyLayout shape:
 * guard on role="parent", the portal's own app bar, and the desktop width
 * cap around a Suspense'd Outlet.
 */
export function FamilyLayout() {
  // Ground reaches html too (#424): iOS overscroll + the AuthGuard resolve
  // state paint the canvas, which no descendant div can tint.
  useDocumentGround('app');
  return (
    <AuthGuard role="parent">
      {/* pb-16 clears the fixed app-switch bar on phones; the bar is
          md:hidden so the padding lifts at the same breakpoint. */}
      <div className="min-h-screen bg-ground pb-16 md:pb-0">
        <FamilyAppBar />
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
        <AppSwitchBarHost homeHref="/family" />
      </div>
    </AuthGuard>
  );
}
